using System;
using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using LiveWork.Editor;

[InitializeOnLoad]
public static class LiveWorkSample
{
    static double next;
    static LiveWorkSample() {
        if (Array.IndexOf(Environment.GetCommandLineArgs(), "-liveworkTest") >= 0) EditorApplication.update += Diagnostics;
    }
    [MenuItem("LiveWork Sample/Create demo scene")]
    public static void CreateScene()
    {
        var scene = EditorSceneManager.NewScene(NewSceneSetup.DefaultGameObjects);
        new GameObject("Sample gameplay").AddComponent<SampleGame>();
        EditorSceneManager.SaveScene(scene, "Assets/LiveWorkDemo.unity");
        EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene("Assets/LiveWorkDemo.unity", true) };
    }
    public static void Launch()
    {
        CreateScene();
        GameViewBridge.Resize(1280, 720);
        LiveWorkHost.Enable();
        LiveWorkWindow.Open();
        GameViewBridge.View.Focus();
    }
    static void Diagnostics()
    {
        if (EditorApplication.timeSinceStartup < next) return; next = EditorApplication.timeSinceStartup + .1;
        Directory.CreateDirectory("../.artifacts");
        File.WriteAllText("../.artifacts/sample-live.json", JsonUtility.ToJson(new Snapshot {
            playing = EditorApplication.isPlaying, paused = EditorApplication.isPaused, frames = SampleGame.Frames, clicks = SampleGame.Clicks,
            key = SampleGame.NewKey, mouse = SampleGame.NewMouse, x = SampleGame.LastMouse.x, y = SampleGame.LastMouse.y,
            touches = SampleGame.NewTouches, legacyTouches = SampleGame.LegacyTouches, peakTouches = SampleGame.PeakNewTouches, peakLegacyTouches = SampleGame.PeakLegacyTouches,
            width = GameViewBridge.Size.x, height = GameViewBridge.Size.y
            , touchX = SampleGame.LastTouch.x, touchY = SampleGame.LastTouch.y, touchDevice = SampleGame.TouchDevice, pointerEvent = SampleGame.PointerEvent
        }, true));
        // Test-only local shutdown signal. Not available in installed LiveWork packages.
        if (File.Exists("../.artifacts/close-sample")) { File.Delete("../.artifacts/close-sample"); LiveWorkHost.Disable(); EditorApplication.Exit(0); }
        if (File.Exists("../.artifacts/refresh-sample")) { File.Delete("../.artifacts/refresh-sample"); AssetDatabase.Refresh(); }
        if (File.Exists("../.artifacts/reload-scene")) { File.Delete("../.artifacts/reload-scene"); if (EditorApplication.isPlaying) UnityEngine.SceneManagement.SceneManager.LoadScene("LiveWorkDemo"); }
    }
    [Serializable] class Snapshot { public bool playing, paused, key, mouse; public int frames, clicks, touches, legacyTouches, peakTouches, peakLegacyTouches, width, height; public float x, y, touchX, touchY; public string touchDevice, pointerEvent; }
}
