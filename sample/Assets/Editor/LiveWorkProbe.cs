using System;
using System.IO;
using System.Linq;
using System.Reflection;
using UnityEditor;
using UnityEngine;

public static class LiveWorkProbe
{
    public static void RunLegacy()
    {
        Unity.RenderStreaming.RenderStreaming.AutomaticStreaming = false;
        AssetDatabase.SaveAssets();
        var scene = UnityEditor.SceneManagement.EditorSceneManager.NewScene(UnityEditor.SceneManagement.NewSceneSetup.DefaultGameObjects);
        new GameObject("Legacy input probe").AddComponent<LegacyInputProbe>();
        UnityEditor.SceneManagement.EditorSceneManager.SaveScene(scene, "Assets/LegacyProbe.unity");
        var gameView = EditorWindow.GetWindow(typeof(EditorWindow).Assembly.GetType("UnityEditor.GameView"));
        gameView.Show();
        gameView.Focus();
        SessionState.SetBool("LiveWork.Probe", true);
        EditorApplication.isPlaying = true;
    }
    public static void Inspect()
    {
        Directory.CreateDirectory("../.artifacts");
        using (var output = new StreamWriter("../.artifacts/unity-api.txt"))
        {
            output.WriteLine("Unity " + Application.unityVersion);
            var types = new[] { typeof(Input), typeof(EditorWindow), typeof(EditorApplication),
                typeof(EditorWindow).Assembly.GetType("UnityEditor.GameView"),
                typeof(EditorWindow).Assembly.GetType("UnityEditorInternal.InternalEditorUtility") };
            foreach (var type in types.Where(t => t != null))
            {
                output.WriteLine("\nTYPE " + type.FullName);
                foreach (var member in type.GetMembers(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.Static)
                    .Where(m => new[] { "input", "touch", "event", "size", "render", "play", "focus" }.Any(s => m.Name.ToLowerInvariant().Contains(s))))
                    output.WriteLine(member);
            }
        }
        var settings = new SerializedObject(AssetDatabase.LoadAllAssetsAtPath("ProjectSettings/ProjectSettings.asset")[0]);
        settings.FindProperty("activeInputHandler").intValue = 2;
        settings.ApplyModifiedPropertiesWithoutUndo();
        AssetDatabase.SaveAssets();
        Debug.Log("LIVEWORK_API_PROBE_COMPLETE");
    }
}
