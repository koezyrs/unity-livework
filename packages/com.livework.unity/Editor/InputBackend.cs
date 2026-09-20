using System;
using System.Collections.Generic;
using System.Reflection;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.InputSystem.LowLevel;
using UnityEngine.InputSystem.Users;
using UnityEngine.LowLevel;
using TouchPhase = UnityEngine.InputSystem.TouchPhase;

namespace LiveWork.Editor
{
    [Serializable]
    public sealed class RemoteInput
    {
        public int v, revision, id, buttons;
        public string type, phase, code;
        public bool down, locked;
        public float x, y, dx, dy, scroll;
    }

    public sealed class InputBackend : IDisposable
    {
        readonly Queue<RemoteInput> queue = new Queue<RemoteInput>();
        readonly HashSet<Key> keys = new HashSet<Key>();
        readonly Dictionary<int, UnityEngine.Touch> legacyTouches = new Dictionary<int, UnityEngine.Touch>();
        readonly HashSet<int> changedTouches = new HashSet<int>();
        readonly MethodInfo simulate = typeof(Input).GetMethod("SimulateTouch", BindingFlags.Static | BindingFlags.NonPublic);
        readonly PropertyInfo simulation = typeof(Input).GetProperty("simulateTouchEnabled", BindingFlags.Static | BindingFlags.NonPublic);
        readonly bool originalSimulation, originalMouseSimulation;
        Keyboard keyboard;
        Mouse mouse;
        Touchscreen touchscreen;
        Vector2 mousePosition;
        double lastMessage;
        int width, height, revision;
        int lastPumpFrame = -1;
        public bool NewInput { get; }
        public bool Legacy { get; }

        public InputBackend(int width, int height, int revision, int inputMode)
        {
            this.width = width; this.height = height; this.revision = revision;
            NewInput = inputMode != 0; Legacy = inputMode != 1;
            if (Legacy) {
                if (simulate == null || simulation == null) throw new NotSupportedException("Legacy touch API unavailable on this Unity version");
                originalSimulation = (bool)simulation.GetValue(null);
                originalMouseSimulation = Input.simulateMouseWithTouches;
                // Legacy touch produces no emulated mouse; UI chooses its configured module.
                Input.simulateMouseWithTouches = false;
            }
            if (NewInput) {
                // Remote devices remain valid without desktop focus. In particular the UI
                // module suppresses touch-up clicks from non-background devices when unfocused.
                RegisterBackgroundLayout("LiveWorkKeyboard", "Keyboard");
                RegisterBackgroundLayout("LiveWorkMouse", "Mouse");
                RegisterBackgroundLayout("LiveWorkTouchscreen", "Touchscreen");
                keyboard = (Keyboard)InputSystem.AddDevice("LiveWorkKeyboard", "LiveWork Keyboard");
                mouse = (Mouse)InputSystem.AddDevice("LiveWorkMouse", "LiveWork Mouse");
                touchscreen = (Touchscreen)InputSystem.AddDevice("LiveWorkTouchscreen", "LiveWork Touchscreen");
                foreach (var device in new InputDevice[] { keyboard, mouse, touchscreen }) {
                    if (InputUser.all.Count > 0) InputUser.PerformPairingWithDevice(device, InputUser.all[0]);
                }
                InputSystem.onBeforeUpdate += BeforeInputUpdate;
            }
            if (!NewInput) {
                var loop = PlayerLoop.GetCurrentPlayerLoop();
                var systems = new PlayerLoopSystem[loop.subSystemList.Length + 1];
                systems[0] = new PlayerLoopSystem { type = typeof(InputBackend), updateDelegate = Pump };
                Array.Copy(loop.subSystemList, 0, systems, 1, loop.subSystemList.Length);
                loop.subSystemList = systems;
                PlayerLoop.SetPlayerLoop(loop);
            }
            lastMessage = UnityEditor.EditorApplication.timeSinceStartup;
        }

        public void Receive(string json)
        {
            try {
                var msg = JsonUtility.FromJson<RemoteInput>(json);
                if (msg == null || msg.v != 1 || msg.revision != revision) return;
                lastMessage = UnityEditor.EditorApplication.timeSinceStartup;
                if (msg.type == "heartbeat") return;
                if (msg.type == "reset") { Reset(); return; }
                if (queue.Count >= 256) { Reset(); return; }
                queue.Enqueue(msg);
            } catch (ArgumentException) { Reset(); }
        }

        public void CheckTimeout()
        {
            if (UnityEditor.EditorApplication.timeSinceStartup - lastMessage > 2) Reset();
        }

        void BeforeInputUpdate()
        {
            // Editor updates have a separate state buffer. Never consume gameplay events there.
            if (InputState.currentUpdateType != InputUpdateType.Editor && InputState.currentUpdateType != InputUpdateType.BeforeRender) Pump();
        }

        void Pump()
        {
            if (lastPumpFrame == Time.frameCount) return;
            lastPumpFrame = Time.frameCount;
            changedTouches.Clear();
            var count = queue.Count;
            while (count-- > 0) {
                var msg = queue.Peek();
                // Preserve Began -> Moved -> Ended across frames for legacy polling.
                if (msg.type == "touch" && changedTouches.Contains(msg.id)) break;
                queue.Dequeue();
                if (msg.type == "key" && NewInput && TryKey(msg.code, out var key)) {
                    if (msg.down) keys.Add(key); else keys.Remove(key);
                    var array = new Key[keys.Count]; keys.CopyTo(array);
                    InputSystem.QueueStateEvent(keyboard, new KeyboardState(array)); keyboard.MakeCurrent();
                }
                if (msg.type == "mouse" && NewInput && Finite(msg.x, msg.y, msg.dx, msg.dy, msg.scroll)) {
                    var next = msg.locked ? mousePosition + new Vector2(msg.dx * width, -msg.dy * height) : new Vector2(Mathf.Clamp01(msg.x) * width, (1 - Mathf.Clamp01(msg.y)) * height);
                    var delta = next - mousePosition;
                    mousePosition = next;
                    InputSystem.QueueStateEvent(mouse, new MouseState { position = next, delta = delta, buttons = (ushort)(msg.buttons & 31), scroll = new Vector2(0, -msg.scroll) });
                    mouse.MakeCurrent();
                }
                if (msg.type == "touch" && msg.id >= 1 && msg.id <= 10 && Finite(msg.x, msg.y)) {
                    changedTouches.Add(msg.id);
                    var point = new Vector2(Mathf.Clamp01(msg.x) * width, (1 - Mathf.Clamp01(msg.y)) * height);
                    var phase = msg.phase == "began" ? TouchPhase.Began : msg.phase == "moved" ? TouchPhase.Moved : msg.phase == "ended" ? TouchPhase.Ended : TouchPhase.Canceled;
                    if (NewInput) { InputSystem.QueueStateEvent(touchscreen, new TouchState { touchId = msg.id, position = point, phase = phase, pressure = 1 }); touchscreen.MakeCurrent(); }
                    if (Legacy) {
                        simulation.SetValue(null, true);
                        legacyTouches.TryGetValue(msg.id, out var previousTouch);
                        var touch = new UnityEngine.Touch { fingerId = msg.id, position = point, rawPosition = point, deltaPosition = point - previousTouch.position, deltaTime = Time.unscaledDeltaTime, tapCount = 1, pressure = 1, maximumPossiblePressure = 1,
                            phase = phase == TouchPhase.Began ? UnityEngine.TouchPhase.Began : phase == TouchPhase.Moved ? UnityEngine.TouchPhase.Moved : phase == TouchPhase.Ended ? UnityEngine.TouchPhase.Ended : UnityEngine.TouchPhase.Canceled };
                        simulate.Invoke(null, new object[] { touch });
                        if (phase == TouchPhase.Ended || phase == TouchPhase.Canceled) legacyTouches.Remove(msg.id); else legacyTouches[msg.id] = touch;
                    }
                }
            }
            if (Legacy) foreach (var pair in legacyTouches) if (!changedTouches.Contains(pair.Key)) {
                var touch = pair.Value; touch.phase = UnityEngine.TouchPhase.Stationary; touch.deltaPosition = Vector2.zero;
                simulate.Invoke(null, new object[] { touch });
            }
        }

        public void Reset()
        {
            queue.Clear(); keys.Clear();
            if (NewInput) { InputSystem.ResetDevice(keyboard); InputSystem.ResetDevice(mouse); InputSystem.ResetDevice(touchscreen); }
            if (Legacy) {
                foreach (var pair in legacyTouches) { var touch = pair.Value; touch.phase = UnityEngine.TouchPhase.Canceled; simulate.Invoke(null, new object[] { touch }); }
                legacyTouches.Clear();
            }
        }

        public void Dispose()
        {
            if (NewInput) InputSystem.onBeforeUpdate -= BeforeInputUpdate;
            Reset();
            // Remove only our PlayerLoop node; preserve other packages' later modifications.
            var loop = PlayerLoop.GetCurrentPlayerLoop();
            var systems = new List<PlayerLoopSystem>(loop.subSystemList);
            systems.RemoveAll(s => s.type == typeof(InputBackend)); loop.subSystemList = systems.ToArray(); PlayerLoop.SetPlayerLoop(loop);
            if (NewInput) { InputSystem.RemoveDevice(keyboard); InputSystem.RemoveDevice(mouse); InputSystem.RemoveDevice(touchscreen); }
            if (Legacy) { simulation.SetValue(null, originalSimulation); Input.simulateMouseWithTouches = originalMouseSimulation; }
        }

        static bool Finite(params float[] values) { foreach (var v in values) if (float.IsNaN(v) || float.IsInfinity(v)) return false; return true; }
        static void RegisterBackgroundLayout(string name, string parent)
        {
            if (InputSystem.LoadLayout(name) == null) InputSystem.RegisterLayout($"{{\"name\":\"{name}\",\"extend\":\"{parent}\",\"canRunInBackground\":true}}");
        }
        static bool TryKey(string code, out Key key)
        {
            key = Key.None; if (code == null) return false;
            if (code.StartsWith("Key")) code = code.Substring(3);
            else if (code.StartsWith("Digit")) code = "Digit" + code.Substring(5);
            else switch (code) {
                case "ArrowUp": code = "UpArrow"; break; case "ArrowDown": code = "DownArrow"; break;
                case "ArrowLeft": code = "LeftArrow"; break; case "ArrowRight": code = "RightArrow"; break;
                case "ShiftLeft": code = "LeftShift"; break; case "ShiftRight": code = "RightShift"; break;
                case "ControlLeft": code = "LeftCtrl"; break; case "ControlRight": code = "RightCtrl"; break;
                case "AltLeft": code = "LeftAlt"; break; case "AltRight": code = "RightAlt"; break;
                case "MetaLeft": code = "LeftMeta"; break; case "MetaRight": code = "RightMeta"; break;
                case "Backquote": code = "Backquote"; break; case "Equal": code = "Equals"; break;
                case "BracketLeft": code = "LeftBracket"; break; case "BracketRight": code = "RightBracket"; break;
                case "Quote": code = "Quote"; break;
            }
            return Enum.TryParse(code, out key) && Enum.IsDefined(typeof(Key), key) && key != Key.None && (int)key > 0 && (int)key < 256;
        }
    }
}
