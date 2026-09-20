#if UNITY_EDITOR
using System;
using System.IO;
using System.Reflection;
using UnityEditor;
using UnityEngine;
using UnityEngine.LowLevel;
using UnityEngine.InputSystem;
using UnityEngine.InputSystem.LowLevel;

public class LegacyInputProbe : MonoBehaviour
{
    public static int Tick;
    static MethodInfo simulate = typeof(Input).GetMethod("SimulateTouch", BindingFlags.Static | BindingFlags.NonPublic);
    static PropertyInfo simulation = typeof(Input).GetProperty("simulateTouchEnabled", BindingFlags.Static | BindingFlags.NonPublic);
    static bool keyHeld, keyDown, keyUp, axis, mouseHeld, mouseDown, mouseUp, twoTouches, touchEnded, guiKeyDown, guiKeyUp, newKeyHeld;
    static Keyboard keyboard;
    static EditorWindow gameView;
    static StreamWriter log;
    PlayerLoopSystem previous;

    void Awake()
    {
        Tick = 0;
        sentDown = sentUp = false;
        keyHeld = keyDown = keyUp = axis = mouseHeld = mouseDown = mouseUp = twoTouches = touchEnded = guiKeyDown = guiKeyUp = newKeyHeld = false;
        keyboard = InputSystem.AddDevice<Keyboard>("LiveWork Probe Keyboard");
        gameView = EditorWindow.GetWindow(typeof(EditorWindow).Assembly.GetType("UnityEditor.GameView"));
        gameView.Focus();
        log = new StreamWriter("../.artifacts/legacy-frames.txt");
        Application.runInBackground = true;
        UnityEditorInternal.InternalEditorUtility.OnGameViewFocus(true);
        EditorApplication.update += QueueKeys;
        simulation.SetValue(null, false);
        previous = PlayerLoop.GetCurrentPlayerLoop();
        var loop = previous;
        var systems = new PlayerLoopSystem[loop.subSystemList.Length + 1];
        systems[0] = new PlayerLoopSystem { type = typeof(LegacyInputProbe), updateDelegate = Inject };
        Array.Copy(loop.subSystemList, 0, systems, 1, loop.subSystemList.Length);
        loop.subSystemList = systems;
        PlayerLoop.SetPlayerLoop(loop);
    }

    static bool sentDown, sentUp;
    static void QueueKeys()
    {
        if (Tick >= 20 && !sentDown) { sentDown = true; SendKeys(true); }
        if (Tick >= 60 && !sentUp) { sentUp = true; SendKeys(false); }
    }
    static void SendKeys(bool down)
    {
        EditorGUIUtility.QueueGameViewInputEvent(new Event { type = down ? EventType.KeyDown : EventType.KeyUp, keyCode = KeyCode.D, character = 'd' });
        EditorGUIUtility.QueueGameViewInputEvent(new Event { type = down ? EventType.MouseDown : EventType.MouseUp, button = 0, mousePosition = new Vector2(100, 100) });
        gameView.SendEvent(new Event { type = down ? EventType.KeyDown : EventType.KeyUp, keyCode = KeyCode.D, character = 'd' });
        gameView.SendEvent(new Event { type = down ? EventType.MouseDown : EventType.MouseUp, button = 0, mousePosition = new Vector2(100, 100) });
        InputSystem.QueueStateEvent(keyboard, down ? new KeyboardState(Key.D) : new KeyboardState());
    }
    static void Inject()
    {
        Tick++;
        if (Tick == 70) simulation.SetValue(null, true);
        if (Tick >= 70 && Tick <= 80)
        {
            for (int id = 0; id < 2; id++)
                simulate.Invoke(null, new object[] { new UnityEngine.Touch { fingerId = id + 1, position = new Vector2(100 + id * 100, 150), rawPosition = new Vector2(100 + id * 100, 150), phase = Tick == 70 ? UnityEngine.TouchPhase.Began : Tick == 80 ? UnityEngine.TouchPhase.Ended : UnityEngine.TouchPhase.Stationary, tapCount = 1, pressure = 1, maximumPossiblePressure = 1 } });
        }
    }

    void Update()
    {
        keyHeld |= Input.GetKey(KeyCode.D);
        keyDown |= Input.GetKeyDown(KeyCode.D);
        keyUp |= Input.GetKeyUp(KeyCode.D);
        axis |= Input.GetAxisRaw("Horizontal") > 0;
        if (Tick < 70) {
            mouseHeld |= Input.GetMouseButton(0);
            mouseDown |= Input.GetMouseButtonDown(0);
            mouseUp |= Input.GetMouseButtonUp(0);
        }
        newKeyHeld |= keyboard.dKey.isPressed;
        twoTouches |= Input.touchCount == 2;
        foreach (var t in Input.touches) touchEnded |= t.phase == UnityEngine.TouchPhase.Ended;
        log.WriteLine($"{Tick}: key={Input.GetKey(KeyCode.D)} down={Input.GetKeyDown(KeyCode.D)} up={Input.GetKeyUp(KeyCode.D)} axis={Input.GetAxisRaw("Horizontal")} mouse={Input.GetMouseButton(0)} touches={Input.touchCount}");
        if (Tick < 90) return;
        log.Dispose(); log = null;
        File.WriteAllText("../.artifacts/legacy-result.json", JsonUtility.ToJson(new Result {
            unity = Application.unityVersion, keyHeld = keyHeld, keyDown = keyDown, keyUp = keyUp, axis = axis,
            mouseHeld = mouseHeld, mouseDown = mouseDown, mouseUp = mouseUp, twoTouches = twoTouches, touchEnded = touchEnded,
            guiKeyDown = guiKeyDown, guiKeyUp = guiKeyUp, newKeyHeld = newKeyHeld
        }, true));
        SessionState.SetBool("LiveWork.Probe", false);
        EditorApplication.Exit(0);
    }
    void OnGUI() { guiKeyDown |= Event.current.type == EventType.KeyDown && Event.current.keyCode == KeyCode.D; guiKeyUp |= Event.current.type == EventType.KeyUp && Event.current.keyCode == KeyCode.D; }
    void OnDestroy() { EditorApplication.update -= QueueKeys; PlayerLoop.SetPlayerLoop(previous); simulation.SetValue(null, false); if (keyboard != null && keyboard.added) InputSystem.RemoveDevice(keyboard); log?.Dispose(); }
    [Serializable] class Result { public string unity; public bool keyHeld, keyDown, keyUp, axis, mouseHeld, mouseDown, mouseUp, twoTouches, touchEnded, guiKeyDown, guiKeyUp, newKeyHeld; }
}
#endif
