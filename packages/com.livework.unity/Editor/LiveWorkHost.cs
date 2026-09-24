using System;
using System.Collections;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Net.Http;
using System.Threading.Tasks;
using UnityEditor;
using UnityEditor.Compilation;
using UnityEngine;
using UnityEngine.SceneManagement;
using WebSocketSharp;
using Debug = UnityEngine.Debug;
using Object = UnityEngine.Object;

namespace LiveWork.Editor
{
    [Serializable] public class HostConfig { public int port, pid; public string host, code, hostToken, mode; }
    public enum ConnectionMode { Lan, Tailscale, ZeroTier }
    [Serializable] public class Command { public int v, width, height; public string type, id, command, quality, scene; }
    [Serializable] public class HostState {
        public int v = 1, width, height, revision, frame;
        public string type = "state", state, message, inputMode, quality, scene, startScene, unity = Application.unityVersion;
        public bool streaming, isPlaying, isPaused;
    }
    [Serializable] public class CommandResult { public int v = 1; public string type = "result", id, message; public bool ok; }

    [InitializeOnLoad]
    public static class LiveWorkHost
    {
        static WebSocket socket;
        static readonly ConcurrentQueue<string> inbox = new ConcurrentQueue<string>();
        static LiveWorkStream stream;
        static InputBackend input;
        static double nextConnect, nextState, nextCapture;
        static int revision;
        static Command pending;
        static double pendingSince;
        static int stepStart;
        static bool compileError, reloading;
        static bool playReady;
        static bool originalBackground;
        static string error;
        // Set while Unity changes Play Mode, so the browser can say why the Editor is reloading.
        static string playModeChange;
        // Longest stream edge and maximum bitrate (kbps) for each browser quality choice.
        static readonly (string name, int edge, uint bitrate)[] Qualities = { ("smooth", 960, 2500), ("balanced", 1280, 4000), ("sharp", 1280, 8000) };
        static string Quality => SessionState.GetString("LiveWork.Quality", "balanced");
        public static bool Enabled => SessionState.GetBool("LiveWork.Enabled", false);
        public static string Status { get; private set; } = "Disabled";
        public static HostConfig Config { get; private set; }
        public static bool IsStopping { get; private set; }
        public static string ServerError { get; private set; }
        public static string ConfigPath => Path.GetFullPath(Path.Combine(Application.dataPath, "../Library/LiveWork/host.json"));
        public static bool ServerReady => Enabled && !IsStopping && socket?.ReadyState == WebSocketState.Open && Config != null;
        public static string ServerStatus => LiveWorkService.IsPreparing ? "Preparing service…" : IsStopping ? "Ending server…" : ServerError != null ? "Server error" : ServerReady ? "Server running" : Enabled ? "Connecting to server…" : "Server stopped";
        public static ConnectionMode Mode {
            get => (ConnectionMode)Mathf.Clamp(EditorPrefs.GetInt("LiveWork.ConnectionMode", (int)ConnectionMode.Tailscale), 0, 2);
            set {
                if (Enabled || Config != null) throw new InvalidOperationException("End the server to change the connection mode.");
                EditorPrefs.SetInt("LiveWork.ConnectionMode", (int)value);
            }
        }
        /// <summary>The mode of the running server, or the chosen mode when no server runs.</summary>
        public static ConnectionMode ActiveMode => Config != null && Enum.TryParse(Config.mode, true, out ConnectionMode mode) ? mode : Mode;
        public static string ModeName(ConnectionMode mode) => mode == ConnectionMode.Lan ? "LAN" : mode.ToString();
        public static string ServiceDirectory {
            get {
                var saved = EditorPrefs.GetString("LiveWork.ServiceDirectory." + Application.dataPath, "");
                if (Directory.Exists(saved)) return saved;
                return LiveWorkService.ResolveDirectory();
            }
            set => EditorPrefs.SetString("LiveWork.ServiceDirectory." + Application.dataPath, value);
        }

        static LiveWorkHost()
        {
            EditorApplication.delayCall += () => {
                var shutdown = SessionState.GetString("LiveWork.Shutdown", "");
                if (!string.IsNullOrEmpty(shutdown)) _ = EndServerAsync(JsonUtility.FromJson<HostConfig>(shutdown));
                if (Enabled && EditorApplication.isPlaying && SessionState.GetBool("LiveWork.PlayReady", false)) {
                    // Package pre.8 initializes this only on entering Play, not on script reload.
                    typeof(Unity.WebRTC.WebRTC).GetMethod("RuntimeInitializeOnLoadMethod", System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.NonPublic)?.Invoke(null, null);
                    playReady = true;
                }
            };
            var saved = SessionState.GetString("LiveWork.Pending", "");
            if (!string.IsNullOrEmpty(saved)) { pending = JsonUtility.FromJson<Command>(saved); pendingSince = EditorApplication.timeSinceStartup; SessionState.EraseString("LiveWork.Pending"); }
            EditorApplication.update += Update;
            EditorApplication.playModeStateChanged += OnPlayMode;
            EditorApplication.pauseStateChanged += _ => Publish();
            AssemblyReloadEvents.beforeAssemblyReload += BeforeReload;
            EditorApplication.quitting += Disable;
            CompilationPipeline.compilationStarted += _ => { compileError = false; reloading = true; input?.Reset(); StopStream(); Publish(); };
            CompilationPipeline.assemblyCompilationFinished += (_, messages) => { if (messages.Any(m => m.type == CompilerMessageType.Error)) compileError = true; };
            CompilationPipeline.compilationFinished += _ => { reloading = false; if (compileError) error = "Compilation failed. Fix Unity Console errors before Play."; Publish(); };
            EditorApplication.projectChanged += LiveWorkScenes.MarkDirty;
            EditorBuildSettings.sceneListChanged += LiveWorkScenes.MarkDirty;
            if (Enabled) LiveWorkConsole.Start();
            LiveWorkStream.InputReceived = json => input?.Receive(json);
            LiveWorkStream.InputDisconnected = () => input?.Reset();
        }

        public static void Enable()
        {
            if (IsStopping) throw new InvalidOperationException("Wait for the server to finish stopping.");
            if (Enabled) return;
            ServerError = null;
            if (Application.unityVersion != "6000.3.11f1" && Application.unityVersion != "6000.2.7f2") throw new NotSupportedException("This preview supports Unity 6000.3.11f1 and 6000.2.7f2 only.");
            if (Unity.RenderStreaming.RenderStreaming.AutomaticStreaming) throw new InvalidOperationException("Disable Render Streaming > Automatic Streaming first; LiveWork manages its own session.");
            if (!File.Exists(Path.Combine(ServiceDirectory, "server.mjs"))) throw new DirectoryNotFoundException("Choose the LiveWork service folder first.");
            if (!File.Exists(Path.Combine(ServiceDirectory, "generated/signaling.cjs"))) throw new InvalidOperationException("Run npm ci and npm run build inside the service folder first.");
            ReadConfig();
            if (Config == null || !ProcessAlive(Config.pid)) {
                var mode = Mode;
                var network = FindNetwork(mode);
                // Tailscale keeps working on localhost until Tailscale connects; its address range is fixed.
                if (mode != ConnectionMode.Tailscale && network == null) throw new InvalidOperationException(mode == ConnectionMode.Lan
                    ? "No LAN network found. Connect to Wi-Fi or Ethernet, then start the server again."
                    : "ZeroTier is not connected. Join your ZeroTier network, then start the server again.");
                if (File.Exists(ConfigPath)) File.Delete(ConfigPath);
                Config = null;
                var info = new ProcessStartInfo("node", "server.mjs") { WorkingDirectory = ServiceDirectory, UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden };
                info.EnvironmentVariables["LIVEWORK_BIND"] = "0.0.0.0";
                info.EnvironmentVariables["LIVEWORK_PORT"] = "0";
                info.EnvironmentVariables["LIVEWORK_MODE"] = mode.ToString().ToLowerInvariant();
                info.EnvironmentVariables["LIVEWORK_TRUST"] = mode == ConnectionMode.Tailscale ? "100.64.0.0/10,fd7a:115c:a1e0::/48" : network.Value.subnet;
                info.EnvironmentVariables["LIVEWORK_STATE_DIRECTORY"] = Path.GetDirectoryName(ConfigPath);
                Process.Start(info);
            }
            SessionState.SetBool("LiveWork.Enabled", true);
            LiveWorkConsole.Start();
            originalBackground = Application.runInBackground;
            SessionState.SetBool("LiveWork.Background", originalBackground);
            GameViewBridge.Remember(); GameViewBridge.View.Show();
            error = null; nextConnect = 0; Status = "Connecting";
        }

        static bool ProcessAlive(int pid) { try { return Process.GetProcessById(pid).ProcessName.StartsWith("node", StringComparison.OrdinalIgnoreCase); } catch { return false; } }
        static void ReadConfig() {
            try { Config = JsonUtility.FromJson<HostConfig>(File.ReadAllText(ConfigPath)); }
            catch { Config = null; }
        }
        public static string BrowserUrl => $"http://{FindNetwork(ActiveMode)?.ip ?? "127.0.0.1"}:{Config?.port ?? 8080}";

        /// <summary>Finds this computer's IPv4 address and subnet on the network of the given mode.</summary>
        static (string ip, string subnet)? FindNetwork(ConnectionMode mode)
        {
            foreach (var n in NetworkInterface.GetAllNetworkInterfaces()) {
                if (n.OperationalStatus != OperationalStatus.Up || n.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;
                bool zeroTier = Named(n, "ZeroTier"), tailscaleAdapter = Named(n, "Tailscale");
                var properties = n.GetIPProperties();
                foreach (var a in properties.UnicastAddresses) {
                    if (a.Address.AddressFamily != AddressFamily.InterNetwork) continue;
                    var b = a.Address.GetAddressBytes();
                    bool tailscale = b[0] == 100 && b[1] >= 64 && b[1] <= 127;
                    bool match = mode == ConnectionMode.Tailscale ? tailscale
                        : mode == ConnectionMode.ZeroTier ? zeroTier
                        : !zeroTier && !tailscaleAdapter && !tailscale && IsPrivate(b) && HasGateway(properties);
                    if (match) return (a.Address.ToString(), Subnet(b, a.IPv4Mask));
                }
            }
            return null;
        }
        static bool Named(NetworkInterface n, string name) => n.Name.IndexOf(name, StringComparison.OrdinalIgnoreCase) >= 0 || n.Description.IndexOf(name, StringComparison.OrdinalIgnoreCase) >= 0;
        static bool IsPrivate(byte[] b) => b[0] == 10 || (b[0] == 172 && b[1] >= 16 && b[1] <= 31) || (b[0] == 192 && b[1] == 168);
        // Virtual adapters (Hyper-V, VirtualBox, WSL) usually have no default gateway; the real LAN adapter does.
        static bool HasGateway(IPInterfaceProperties properties) => properties.GatewayAddresses.Any(g => g.Address.AddressFamily == AddressFamily.InterNetwork && !g.Address.Equals(IPAddress.Any));
        static string Subnet(byte[] address, IPAddress mask)
        {
            var m = mask?.GetAddressBytes();
            int prefix = m == null || m.Length != 4 ? 0 : m.Sum(x => Convert.ToString(x, 2).Count(c => c == '1'));
            // Some adapters report no mask; trust a /24 instead of the whole address space.
            if (prefix < 8) { prefix = 24; m = new byte[] { 255, 255, 255, 0 }; }
            return $"{address[0] & m[0]}.{address[1] & m[1]}.{address[2] & m[2]}.{address[3] & m[3]}/{prefix}";
        }

        static void Update()
        {
            if (!Enabled) return;
            var now = EditorApplication.timeSinceStartup;
            if (socket == null && now >= nextConnect) {
                nextConnect = now + 2; ReadConfig();
                if (Config != null) {
                    var ws = new WebSocket($"ws://127.0.0.1:{Config.port}/editor?token={Config.hostToken}");
                    ws.OnMessage += (_, e) => { if (e.IsText) inbox.Enqueue(e.Data); };
                    ws.OnClose += (_, __) => inbox.Enqueue("{\"type\":\"closed\"}");
                    ws.OnError += (_, __) => inbox.Enqueue("{\"type\":\"closed\"}");
                    socket = ws; ws.ConnectAsync();
                }
            }
            while (inbox.TryDequeue(out var json)) {
                try {
                    var cmd = JsonUtility.FromJson<Command>(json);
                    if (cmd.type == "closed") { socket?.CloseAsync(); socket = null; input?.Reset(); StopStream(); Status = "Disconnected"; }
                    else if (cmd.type == "resetInput") input?.Reset();
                    else if (cmd.type == "hello") { LiveWorkScenes.Invalidate(); Publish(); }
                    else if (cmd.type == "command") Execute(cmd);
                } catch (Exception ex) { error = ex.Message; }
            }
            if (playReady && EditorApplication.isPlaying && !reloading && !EditorApplication.isCompiling && socket?.ReadyState == WebSocketState.Open && stream == null && error == null) {
                try { StartStream(); } catch (Exception ex) { error = ex.Message; StopStream(); Debug.LogException(ex); }
            }
            input?.CheckTimeout();
            if (stream != null && now >= nextCapture) {
                // Keep a fixed cadence instead of drifting by the late part of each tick.
                nextCapture = Math.Max(nextCapture + 1.0 / 30, now);
                try {
                    // Play Mode repaints the Game View every frame; a paused game needs a manual repaint.
                    if (EditorApplication.isPaused) GameViewBridge.View.Repaint();
                    var source = GameViewBridge.Texture;
                    if (source != null && stream.Texture != null) {
                        // WebRTC's default texture copy flips Direct3D render textures.
                        if (SystemInfo.graphicsUVStartsAtTop) Graphics.Blit(source, stream.Texture, new Vector2(1, -1), new Vector2(0, 1));
                        else Graphics.Blit(source, stream.Texture);
                    }
                    stream.RefreshAudio();
                    stream.Tick();
                } catch (Exception ex) { error = ex.Message; }
            }
            CompletePending(now);
            if (socket?.ReadyState == WebSocketState.Open) {
                var logs = LiveWorkConsole.Flush(now);
                if (logs != null) SendJson(logs);
                var scenes = LiveWorkScenes.Poll(now);
                if (scenes != null) SendJson(scenes);
            }
            if (now >= nextState) { nextState = now + .5; Publish(); }
        }

        // Active Input Handling changes require an Editor restart, so one read per domain is enough.
        static int inputMode = -1;
        static int InputMode() {
            if (inputMode >= 0) return inputMode;
            var settings = new SerializedObject(AssetDatabase.LoadAllAssetsAtPath("ProjectSettings/ProjectSettings.asset")[0]);
            return inputMode = settings.FindProperty("activeInputHandler").intValue;
        }

        static void StartStream()
        {
            var size = GameViewBridge.Size;
            // Encoder requires even dimensions; initial rendering keeps the user's Game View size.
            int w = Mathf.Max(2, size.x / 2 * 2), h = Mathf.Max(2, size.y / 2 * 2);
            var quality = Qualities.First(q => q.name == Quality);
            float scale = Mathf.Min(1, Mathf.Min((float)quality.edge / w, (float)quality.edge / h));
            w = Mathf.Max(2, (int)(w * scale) / 2 * 2); h = Mathf.Max(2, (int)(h * scale) / 2 * 2);
            revision = SessionState.GetInt("LiveWork.Revision", 0) + 1; SessionState.SetInt("LiveWork.Revision", revision);
            input = new InputBackend(size.x, size.y, revision, InputMode());
            var go = new GameObject("LiveWork Session") { hideFlags = HideFlags.DontSave };
            Object.DontDestroyOnLoad(go);
            stream = go.AddComponent<LiveWorkStream>();
            stream.Initialize($"ws://127.0.0.1:{Config.port}/signal/editor?token={Config.hostToken}", w, h, quality.bitrate);
            Application.runInBackground = true;
            Publish();
        }

        static void StopStream()
        {
            if (stream != null) Object.DestroyImmediate(stream.gameObject);
            stream = null; input?.Dispose(); input = null;
        }
        static void OnPlayMode(PlayModeStateChange state)
        {
            if (state == PlayModeStateChange.EnteredPlayMode) { playReady = true; SessionState.SetBool("LiveWork.PlayReady", true); }
            if (state == PlayModeStateChange.ExitingPlayMode || state == PlayModeStateChange.ExitingEditMode) { playReady = false; SessionState.SetBool("LiveWork.PlayReady", false); }
            if (state == PlayModeStateChange.ExitingEditMode) LiveWorkScenes.OnExitingEditMode();
            if (state == PlayModeStateChange.EnteredEditMode) LiveWorkScenes.OnEnteredEditMode(message => { error = message; Publish(); });
            playModeChange = state == PlayModeStateChange.ExitingEditMode ? "Unity is starting Play Mode…" : state == PlayModeStateChange.ExitingPlayMode ? "Unity is stopping Play Mode…" : null;
            if (!Enabled) return;
            if (state == PlayModeStateChange.ExitingPlayMode) StopStream();
            if (state == PlayModeStateChange.EnteredEditMode) error = null;
            Publish();
        }
        static void BeforeReload()
        {
            if (!Enabled) return;
            if (pending != null) SessionState.SetString("LiveWork.Pending", JsonUtility.ToJson(pending));
            LiveWorkConsole.Stop();
            reloading = true; Publish(); StopStream(); socket?.Close(); socket = null;
        }
        public static void Disable()
        {
            if (!Enabled) return;
            SessionState.SetBool("LiveWork.Enabled", false);
            LiveWorkConsole.Stop(); LiveWorkConsole.Clear(); LiveWorkScenes.Restore();
            StopStream(); socket?.Close(); socket = null; GameViewBridge.Restore(); Status = "Disabled";
            Application.runInBackground = SessionState.GetBool("LiveWork.Background", false);
            pending = null;
        }

        public static Task EndServerAsync() => EndServerAsync(Config);
        static async Task EndServerAsync(HostConfig config)
        {
            if (IsStopping) return;
            IsStopping = true; ServerError = null;
            if (config != null) SessionState.SetString("LiveWork.Shutdown", JsonUtility.ToJson(config));
            Disable();
            try {
                if (config == null) throw new InvalidOperationException("Server address is unavailable. Wait for the service to start and try again.");
                using (var client = new HttpClient(new HttpClientHandler { UseProxy = false }) { Timeout = TimeSpan.FromSeconds(3) }) {
                    var url = $"http://127.0.0.1:{config.port}";
                    bool reachable;
                    try { using (var health = await client.GetAsync(url + "/api/health")) reachable = true; }
                    catch (HttpRequestException) { reachable = false; }
                    if (reachable) {
                        using (var request = new HttpRequestMessage(HttpMethod.Post, url + "/api/shutdown")) {
                            request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", config.hostToken);
                            using (var response = await client.SendAsync(request)) {
                                if (!response.IsSuccessStatusCode) throw new InvalidOperationException("Server could not stop. Check that it uses the current LiveWork service version, then retry End server.");
                            }
                        }
                        var deadline = DateTime.UtcNow.AddSeconds(10);
                        while (true) {
                            await Task.Delay(150);
                            try { using (var health = await client.GetAsync(url + "/api/health")) { } }
                            catch (HttpRequestException) { break; }
                            if (DateTime.UtcNow >= deadline) throw new TimeoutException("Server is still shutting down. Retry End server.");
                        }
                    }
                }
                Config = null;
            } catch (Exception ex) { ServerError = ex.Message; }
            finally { IsStopping = false; SessionState.EraseString("LiveWork.Shutdown"); }
        }

        static void Execute(Command cmd)
        {
            if (cmd.v != 1) { Reply(cmd, false, "Unsupported protocol"); return; }
            if (pending != null) { Reply(cmd, false, "Another Editor action is pending"); return; }
            if (EditorApplication.isCompiling || reloading) { Reply(cmd, false, "Editor is compiling"); return; }
            try {
                switch (cmd.command) {
                    case "Play":
                        if (compileError || EditorUtility.scriptCompilationFailed) throw new InvalidOperationException("Fix compilation errors before Play");
                        error = null;
                        if (!string.IsNullOrEmpty(cmd.scene)) { input?.Reset(); LiveWorkScenes.Restart(cmd.scene); }
                        else EditorApplication.isPlaying = true;
                        break;
                    case "SelectScene":
                        if (EditorApplication.isPlaying) throw new InvalidOperationException("Stop first, or restart in the scene");
                        LiveWorkScenes.Select(cmd.scene); break;
                    case "Stop": input?.Reset(); EditorApplication.isPlaying = false; break;
                    case "Pause":
                        if (!EditorApplication.isPlaying) throw new InvalidOperationException("Play first");
                        input?.Reset(); EditorApplication.isPaused = true; break;
                    case "Resume":
                        if (!EditorApplication.isPlaying) throw new InvalidOperationException("Play first");
                        EditorApplication.isPaused = false; break;
                    case "Step":
                        if (!EditorApplication.isPlaying || !EditorApplication.isPaused) throw new InvalidOperationException("Next Frame requires paused Play Mode");
                        stepStart = Time.frameCount; EditorApplication.Step(); break;
                    case "SetResolution":
                        if (cmd.width < 240 || cmd.height < 240 || cmd.width > 1920 || cmd.height > 1920 || cmd.width % 2 != 0 || cmd.height % 2 != 0 || (long)cmd.width * cmd.height > 2073600) throw new ArgumentException("Unsupported resolution");
                        StopStream(); GameViewBridge.Resize(cmd.width, cmd.height); break;
                    case "SetStreamQuality":
                        if (!Qualities.Any(q => q.name == cmd.quality)) throw new ArgumentException("Unknown stream quality");
                        // Update() recreates the stream with the new settings while Play Mode is active.
                        SessionState.SetString("LiveWork.Quality", cmd.quality); StopStream(); break;
                    default: throw new ArgumentException("Unknown command");
                }
                pending = cmd; pendingSince = EditorApplication.timeSinceStartup;
            } catch (Exception ex) { Reply(cmd, false, ex.Message); }
            Publish();
        }
        static void CompletePending(double now)
        {
            if (pending == null) return;
            if (socket?.ReadyState != WebSocketState.Open) return;
            var size = GameViewBridge.Size;
            bool sceneStart = pending.command == "Play" && !string.IsNullOrEmpty(pending.scene);
            // A restart first leaves Play Mode, so wait until Unity plays again from the chosen scene.
            bool done = sceneStart ? EditorApplication.isPlaying && EditorApplication.isPlayingOrWillChangePlaymode && !LiveWorkScenes.Restarting && LiveWorkScenes.StartScene == pending.scene :
                pending.command == "Play" ? EditorApplication.isPlaying : pending.command == "Stop" ? !EditorApplication.isPlaying && !EditorApplication.isPlayingOrWillChangePlaymode :
                pending.command == "Pause" ? EditorApplication.isPaused : pending.command == "Resume" ? !EditorApplication.isPaused :
                pending.command == "Step" ? Time.frameCount > stepStart : pending.command == "SelectScene" ? LiveWorkScenes.StartScene == pending.scene : pending.command == "SetStreamQuality" ? Quality == pending.quality : size.x == pending.width && size.y == pending.height;
            if (done || now - pendingSince > (sceneStart ? 55 : 15)) { Reply(pending, done, done ? "Completed" : "Editor did not reach the requested state"); pending = null; Publish(); }
        }
        static void Reply(Command cmd, bool ok, string message) => Send(new CommandResult { id = cmd.id, ok = ok, message = message });
        static void Send(object value) => SendJson(JsonUtility.ToJson(value));
        static void SendJson(string json) { if (socket?.ReadyState == WebSocketState.Open) socket.SendAsync(json, _ => { }); }
        static void Publish()
        {
            if (!Enabled) return;
            var size = GameViewBridge.Size;
            var mode = InputMode();
            Status = error != null ? "error" : reloading || EditorApplication.isCompiling ? "reloading" : EditorApplication.isPlaying ? EditorApplication.isPaused ? "paused" : "playing" : "stopped";
            var reloadMessage = playModeChange ?? (EditorApplication.isCompiling ? "Unity is compiling scripts…" : "Unity is reloading scripts…");
            Send(new HostState { state = Status, message = error ?? (Status == "reloading" ? reloadMessage : ""), width = size.x, height = size.y, revision = revision,
                frame = EditorApplication.isPlaying ? Time.frameCount : 0, inputMode = mode == 0 ? "legacy-touch" : mode == 1 ? "input-system" : "both", quality = Quality, streaming = stream != null,
                scene = EditorApplication.isPlaying ? SceneManager.GetActiveScene().path : "", startScene = LiveWorkScenes.Current,
                isPlaying = EditorApplication.isPlaying, isPaused = EditorApplication.isPaused });
        }
    }

}
