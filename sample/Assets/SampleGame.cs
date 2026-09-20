using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.EventSystems;
using UnityEngine.UI;

// Ordinary gameplay code: this component does not reference LiveWork.
public class SampleGame : MonoBehaviour
{
    public static int Frames, Clicks, NewTouches, LegacyTouches;
    public static bool NewKey, NewMouse;
    public static Vector2 LastMouse;
    public static int PeakNewTouches, PeakLegacyTouches;
    public static Vector2 LastTouch;
    public static string TouchDevice, PointerEvent;
    Text readout;
    Transform cube;

    void Start()
    {
        Frames = Clicks = PeakNewTouches = PeakLegacyTouches = 0;
        cube = GameObject.CreatePrimitive(PrimitiveType.Cube).transform;
        cube.position = Vector3.zero;
        var material = new Material(Shader.Find("Standard")); material.color = new Color(.4f, .9f, .65f); cube.GetComponent<Renderer>().material = material;
        var floor = GameObject.CreatePrimitive(PrimitiveType.Plane); floor.transform.position = new Vector3(0, -1, 0);
        var floorMaterial = new Material(Shader.Find("Standard")); floorMaterial.color = new Color(.12f, .17f, .23f); floor.GetComponent<Renderer>().material = floorMaterial;
        var camera = Camera.main; camera.transform.position = new Vector3(0, 2, -7); camera.transform.LookAt(Vector3.zero); camera.backgroundColor = new Color(.055f, .08f, .12f); camera.clearFlags = CameraClearFlags.SolidColor;
        var canvas = new GameObject("Game UI", typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster)).GetComponent<Canvas>();
        canvas.renderMode = RenderMode.ScreenSpaceOverlay;
        canvas.GetComponent<CanvasScaler>().uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
        canvas.GetComponent<CanvasScaler>().referenceResolution = new Vector2(1280, 720);
        var label = new GameObject("Readout", typeof(RectTransform), typeof(Text)); label.transform.SetParent(canvas.transform, false);
        var rect = label.GetComponent<RectTransform>(); rect.anchorMin = new Vector2(0, 1); rect.anchorMax = new Vector2(1, 1); rect.pivot = new Vector2(.5f, 1); rect.anchoredPosition = new Vector2(0, -25); rect.sizeDelta = new Vector2(-50, 180);
        readout = label.GetComponent<Text>(); readout.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf"); readout.fontSize = 25; readout.color = Color.white; readout.raycastTarget = false;
        var buttonObject = new GameObject("Test button", typeof(RectTransform), typeof(Image), typeof(Button)); buttonObject.transform.SetParent(canvas.transform, false);
        var buttonRect = buttonObject.GetComponent<RectTransform>(); buttonRect.anchorMin = buttonRect.anchorMax = new Vector2(.5f, 0); buttonRect.pivot = new Vector2(.5f, 0); buttonRect.anchoredPosition = new Vector2(0, 45); buttonRect.sizeDelta = new Vector2(280, 65);
        buttonObject.GetComponent<Image>().color = new Color(.55f, .95f, .72f);
        buttonObject.GetComponent<Button>().onClick.AddListener(() => Clicks++);
        buttonObject.AddComponent<SamplePointerProbe>();
        var buttonLabel = new GameObject("Label", typeof(RectTransform), typeof(Text)); buttonLabel.transform.SetParent(buttonObject.transform, false);
        var labelRect = buttonLabel.GetComponent<RectTransform>(); labelRect.anchorMin = Vector2.zero; labelRect.anchorMax = Vector2.one; labelRect.offsetMin = labelRect.offsetMax = Vector2.zero;
        var text = buttonLabel.GetComponent<Text>(); text.font = readout.font; text.fontSize = 24; text.alignment = TextAnchor.MiddleCenter; text.color = Color.black; text.text = "TAP / CLICK ME";
        var eventSystem = new GameObject("EventSystem", typeof(EventSystem));
#if ENABLE_INPUT_SYSTEM
        eventSystem.AddComponent<UnityEngine.InputSystem.UI.InputSystemUIInputModule>().AssignDefaultActions();
#else
        eventSystem.AddComponent<StandaloneInputModule>();
#endif
        var sound = gameObject.AddComponent<AudioSource>();
        var clip = AudioClip.Create("LiveWork test tone", 48000, 1, 48000, false);
        var samples = new float[48000]; for (int i = 0; i < samples.Length; i++) samples[i] = Mathf.Sin(2 * Mathf.PI * 220 * i / 48000) * .05f;
        clip.SetData(samples, 0); sound.clip = clip; sound.loop = true; sound.Play();
    }
    void Update()
    {
        Frames++;
#if ENABLE_INPUT_SYSTEM
        NewKey = Keyboard.current != null && Keyboard.current.dKey.isPressed;
        NewMouse = Mouse.current != null && Mouse.current.leftButton.isPressed;
        LastMouse = Mouse.current != null ? Mouse.current.position.ReadValue() : Vector2.zero;
        NewTouches = 0; if (Touchscreen.current != null) {
            TouchDevice = Touchscreen.current.name;
            foreach (var touch in Touchscreen.current.touches) if (touch.press.isPressed) { NewTouches++; LastTouch = touch.position.ReadValue(); }
        }
#endif
#if ENABLE_LEGACY_INPUT_MANAGER
        LegacyTouches = Input.touchCount;
#endif
        PeakNewTouches = Mathf.Max(PeakNewTouches, NewTouches); PeakLegacyTouches = Mathf.Max(PeakLegacyTouches, LegacyTouches);
        cube.Rotate(Vector3.up, Time.deltaTime * 25);
        if (NewKey) cube.position += Vector3.right * Time.deltaTime;
        readout.text = $"LIVEWORK · GAME VIEW\nFrame {Frames}    {Screen.width} × {Screen.height}    Clicks {Clicks}\nNew touch {NewTouches} · Legacy touch {LegacyTouches} · D {NewKey} · Mouse {NewMouse}\nHold D to move. Touch the button. Pause / step to inspect.";
    }
}

public sealed class SamplePointerProbe : MonoBehaviour, IPointerDownHandler, IPointerUpHandler, IPointerClickHandler
{
    public void OnPointerDown(PointerEventData e) { SampleGame.PointerEvent = "down " + e.position; }
    public void OnPointerUp(PointerEventData e) { SampleGame.PointerEvent = "up " + e.position; }
    public void OnPointerClick(PointerEventData e) { SampleGame.PointerEvent = "click " + e.position; }
}
