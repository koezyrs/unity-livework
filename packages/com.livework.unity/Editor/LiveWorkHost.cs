using System;
using System.Collections;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.NetworkInformation;
using UnityEditor;
using UnityEditor.Compilation;
using UnityEngine;
using WebSocketSharp;
using Debug = UnityEngine.Debug;
using Object = UnityEngine.Object;

namespace LiveWork.Editor
{
    [Serializable] public class HostConfig { public int port, pid; public string host, code, hostToken; }
    [Serializable] public class Command { public int v, width, height; public string type, id, command; }
    [Serializable] public class HostState {
        public int v = 1, width, height, revision, frame;
        public string type = "state", state, message, inputMode, unity = Application.unityVersion;
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
        public static bool Enabled => SessionState.GetBool("LiveWork.Enabled", false);
        public static string Status { get; private set; } = "Disabled";
        public static HostConfig Config { get; private set; }
        public static string ServiceDirectory {
            get {
                var saved = EditorPrefs.GetString("LiveWork.ServiceDirectory", "");
                if (Directory.Exists(saved)) return saved;
                var package = UnityEditor.PackageManager.PackageInfo.FindForAssembly(typeof(LiveWorkHost).Assembly);
                return Path.GetFullPath(Path.Combine(package.resolvedPath, "../../service"));
            }
            set => EditorPrefs.SetString("LiveWork.ServiceDirectory", value);
        }

        static LiveWorkHost()
        {
            EditorApplication.delayCall += () => {
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
            LiveWorkStream.InputReceived = json => input?.Receive(json);
            LiveWorkStream.InputDisconnected = () => input?.Reset();
        }

        public static void Enable()
        {
            if (Application.unityVersion != "6000.3.11f1" && Application.unityVersion != "6000.2.7f2") throw new NotSupportedException("This preview supports Unity 6000.3.11f1 and 6000.2.7f2 only.");
            if (Unity.RenderStreaming.RenderStreaming.AutomaticStreaming) throw new InvalidOperationException("Disable Render Streaming > Automatic Streaming first; LiveWork manages its own session.");
            if (!File.Exists(Path.Combine(ServiceDirectory, "server.mjs"))) throw new DirectoryNotFoundException("Choose the LiveWork service folder first.");
            if (!File.Exists(Path.Combine(ServiceDirectory, "generated/signaling.cjs"))) throw new InvalidOperationException("Run npm ci and npm run build inside the service folder first.");
            ReadConfig();
            if (Config == null || !ProcessAlive(Config.pid)) {
                var info = new ProcessStartInfo("node", "server.mjs") { WorkingDirectory = ServiceDirectory, UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden };
                info.EnvironmentVariables["LIVEWORK_BIND"] = "0.0.0.0";
                Process.Start(info);
            }
            SessionState.SetBool("LiveWork.Enabled", true);
            originalBackground = Application.runInBackground;
            SessionState.SetBool("LiveWork.Background", originalBackground);
            GameViewBridge.Remember(); GameViewBridge.View.Show();
            error = null; nextConnect = 0; Status = "Connecting";
        }

        static bool ProcessAlive(int pid) { try { return Process.GetProcessById(pid).ProcessName.StartsWith("node", StringComparison.OrdinalIgnoreCase); } catch { return false; } }
        static void ReadConfig() {
            try { Config = JsonUtility.FromJson<HostConfig>(File.ReadAllText(Path.Combine(ServiceDirectory, ".local/host.json"))); }
            catch { Config = null; }
        }
        public static string BrowserUrl {
            get {
                var ip = NetworkInterface.GetAllNetworkInterfaces().Where(n => n.OperationalStatus == OperationalStatus.Up)
                    .SelectMany(n => n.GetIPProperties().UnicastAddresses).Select(a => a.Address.ToString())
                    .FirstOrDefault(a => { var s = a.Split('.'); return s.Length == 4 && s[0] == "100" && int.TryParse(s[1], out var n) && n >= 64 && n <= 127; });
                return $"http://{ip ?? "127.0.0.1"}:{Config?.port ?? 8080}";
            }
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
                    else if (cmd.type == "hello") Publish();
                    else if (cmd.type == "command") Execute(cmd);
                } catch (Exception ex) { error = ex.Message; }
            }
            if (playReady && EditorApplication.isPlaying && !reloading && !EditorApplication.isCompiling && socket?.ReadyState == WebSocketState.Open && stream == null && error == null) {
                try { StartStream(); } catch (Exception ex) { error = ex.Message; StopStream(); Debug.LogException(ex); }
            }
            input?.CheckTimeout();
            if (stream != null && now >= nextCapture) {
                nextCapture = now + 1.0 / 30;
                try {
                    GameViewBridge.View.Repaint();
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
            if (now >= nextState) { nextState = now + .5; Publish(); }
        }

        static int InputMode() {
            var settings = new SerializedObject(AssetDatabase.LoadAllAssetsAtPath("ProjectSettings/ProjectSettings.asset")[0]);
            return settings.FindProperty("activeInputHandler").intValue;
        }

        static void StartStream()
        {
            var size = GameViewBridge.Size;
            // Encoder requires even dimensions; initial rendering keeps the user's Game View size.
            int w = Mathf.Max(2, size.x / 2 * 2), h = Mathf.Max(2, size.y / 2 * 2);
            float scale = Mathf.Min(1, Mathf.Min(1280f / w, 1280f / h));
            w = Mathf.Max(2, (int)(w * scale) / 2 * 2); h = Mathf.Max(2, (int)(h * scale) / 2 * 2);
            revision = SessionState.GetInt("LiveWork.Revision", 0) + 1; SessionState.SetInt("LiveWork.Revision", revision);
            input = new InputBackend(size.x, size.y, revision, InputMode());
            var go = new GameObject("LiveWork Session") { hideFlags = HideFlags.DontSave };
            Object.DontDestroyOnLoad(go);
            stream = go.AddComponent<LiveWorkStream>();
            stream.Initialize($"ws://127.0.0.1:{Config.port}/signal/editor?token={Config.hostToken}", w, h);
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
            if (!Enabled) return;
            if (state == PlayModeStateChange.ExitingPlayMode) StopStream();
            if (state == PlayModeStateChange.EnteredEditMode) error = null;
            Publish();
        }
        static void BeforeReload()
        {
            if (!Enabled) return;
            if (pending != null) SessionState.SetString("LiveWork.Pending", JsonUtility.ToJson(pending));
            reloading = true; Publish(); StopStream(); socket?.Close(); socket = null;
        }
        public static void Disable()
        {
            if (!Enabled) return;
            SessionState.SetBool("LiveWork.Enabled", false);
            StopStream(); socket?.Close(); socket = null; GameViewBridge.Restore(); Status = "Disabled";
            Application.runInBackground = SessionState.GetBool("LiveWork.Background", false);
            pending = null;
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
                        error = null; EditorApplication.isPlaying = true; break;
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
            bool done = pending.command == "Play" ? EditorApplication.isPlaying : pending.command == "Stop" ? !EditorApplication.isPlaying && !EditorApplication.isPlayingOrWillChangePlaymode :
                pending.command == "Pause" ? EditorApplication.isPaused : pending.command == "Resume" ? !EditorApplication.isPaused :
                pending.command == "Step" ? Time.frameCount > stepStart : size.x == pending.width && size.y == pending.height;
            if (done || now - pendingSince > 15) { Reply(pending, done, done ? "Completed" : "Editor did not reach the requested state"); pending = null; Publish(); }
        }
        static void Reply(Command cmd, bool ok, string message) => Send(new CommandResult { id = cmd.id, ok = ok, message = message });
        static void Send(object value) { if (socket?.ReadyState == WebSocketState.Open) socket.SendAsync(JsonUtility.ToJson(value), _ => { }); }
        static void Publish()
        {
            if (!Enabled) return;
            var size = GameViewBridge.Size;
            var mode = InputMode();
            Status = error != null ? "error" : reloading || EditorApplication.isCompiling ? "reloading" : EditorApplication.isPlaying ? EditorApplication.isPaused ? "paused" : "playing" : "stopped";
            Send(new HostState { state = Status, message = error ?? "", width = size.x, height = size.y, revision = revision,
                frame = EditorApplication.isPlaying ? Time.frameCount : 0, inputMode = mode == 0 ? "legacy-touch" : mode == 1 ? "input-system" : "both", streaming = stream != null,
                isPlaying = EditorApplication.isPlaying, isPaused = EditorApplication.isPaused });
        }
    }

    public sealed class LiveWorkWindow : EditorWindow
    {
        [MenuItem("Window/LiveWork")]
        public static void Open() => GetWindow<LiveWorkWindow>("LiveWork");
        void OnInspectorUpdate() => Repaint();
        void OnGUI()
        {
            GUILayout.Label("Unity LiveWork", EditorStyles.boldLabel);
            EditorGUILayout.HelpBox("Android / PC browser • Unity 6000.3.11f1 / 6000.2.7f2\nInput System: touch, mouse, keyboard\nLegacy: touch only (no mouse/keyboard/axes)", MessageType.Info);
            EditorGUILayout.LabelField("Service", LiveWorkHost.ServiceDirectory);
            if (GUILayout.Button("Choose service folder")) { var path = EditorUtility.OpenFolderPanel("LiveWork service", LiveWorkHost.ServiceDirectory, ""); if (!string.IsNullOrEmpty(path)) LiveWorkHost.ServiceDirectory = path; }
            if (GUILayout.Button(LiveWorkHost.Enabled ? "Disable LiveWork" : "Enable LiveWork")) {
                try { if (LiveWorkHost.Enabled) LiveWorkHost.Disable(); else LiveWorkHost.Enable(); }
                catch (Exception ex) { EditorUtility.DisplayDialog("LiveWork", ex.Message, "OK"); }
            }
            EditorGUILayout.LabelField("Status", LiveWorkHost.Status);
            if (LiveWorkHost.Enabled && LiveWorkHost.Config != null) {
                EditorGUILayout.SelectableLabel(LiveWorkHost.BrowserUrl, GUILayout.Height(20));
                EditorGUILayout.LabelField("Pairing code", LiveWorkHost.Config.code);
                if (GUILayout.Button("Copy URL")) EditorGUIUtility.systemCopyBuffer = LiveWorkHost.BrowserUrl;
                if (GUILayout.Button("Open browser")) Application.OpenURL(LiveWorkHost.BrowserUrl);
            }
        }
    }
}
