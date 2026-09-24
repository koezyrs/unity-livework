using System;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace LiveWork.Editor
{
    [Serializable] public class SceneInfo { public string path, name; public bool inBuild; }
    [Serializable] public class SceneList { public int v = 1; public string type = "scenes"; public SceneInfo[] scenes; public bool truncated; }

    /// <summary>Lists project scenes and starts Play Mode in a chosen scene without opening it in the Editor.</summary>
    public static class LiveWorkScenes
    {
        const int Limit = 2000;
        const string OriginalKey = "LiveWork.StartScene.Original", ChangedKey = "LiveWork.StartScene.Changed", RestartKey = "LiveWork.RestartScene";
        static bool dirty = true;
        static double nextCheck;
        static string lastJson;

        public static bool Restarting => SessionState.GetString(RestartKey, "") != "";
        public static string StartScene => EditorSceneManager.playModeStartScene ? AssetDatabase.GetAssetPath(EditorSceneManager.playModeStartScene) : "";

        public static void MarkDirty() { dirty = true; nextCheck = EditorApplication.timeSinceStartup + 1; }
        /// <summary>Makes the next <see cref="Poll"/> send the list even if it did not change.</summary>
        public static void Invalidate() { dirty = true; nextCheck = 0; lastJson = null; }

        /// <summary>Returns the scene list as JSON when it changed, or null.</summary>
        public static string Poll(double now)
        {
            if (!dirty || now < nextCheck) return null;
            dirty = false;
            var json = JsonUtility.ToJson(List());
            if (json == lastJson) return null;
            return lastJson = json;
        }

        static SceneList List()
        {
            var build = EditorBuildSettings.scenes.Where(s => s.enabled).Select(s => s.path).ToList();
            var paths = AssetDatabase.FindAssets("t:Scene").Select(AssetDatabase.GUIDToAssetPath)
                .Where(p => p.EndsWith(".unity", StringComparison.OrdinalIgnoreCase) && p.Length <= 512).Distinct()
                .OrderBy(p => build.Contains(p) ? build.IndexOf(p) : int.MaxValue)
                .ThenBy(p => p.StartsWith("Packages/", StringComparison.Ordinal) ? 1 : 0)
                .ThenBy(p => p, StringComparer.OrdinalIgnoreCase).ToList();
            return new SceneList {
                scenes = paths.Take(Limit).Select(p => new SceneInfo { path = p, name = Path.GetFileNameWithoutExtension(p), inBuild = build.Contains(p) }).ToArray(),
                truncated = paths.Count > Limit
            };
        }

        static SceneAsset Find(string path) => AssetDatabase.LoadAssetAtPath<SceneAsset>(path) ?? throw new ArgumentException("Scene not found: " + path);

        /// <summary>Enters Play Mode in the scene, or restarts Play Mode in it when already playing.</summary>
        public static void Play(string path)
        {
            Find(path);
            if (EditorApplication.isPlaying) { SessionState.SetString(RestartKey, path); EditorApplication.isPlaying = false; return; }
            Start(path);
        }

        static void Start(string path)
        {
            var scene = Find(path);
            // Keep the user's own start scene so Unity's Play button works as before once we stop.
            if (!SessionState.GetBool(ChangedKey, false)) { SessionState.SetString(OriginalKey, StartScene); SessionState.SetBool(ChangedKey, true); }
            EditorSceneManager.playModeStartScene = scene;
            EditorApplication.isPlaying = true;
        }

        /// <summary>Restores the user's start scene, then continues a pending restart.</summary>
        public static void OnEnteredEditMode(Action<string> fail)
        {
            if (SessionState.GetBool(ChangedKey, false)) {
                var original = SessionState.GetString(OriginalKey, "");
                EditorSceneManager.playModeStartScene = original == "" ? null : AssetDatabase.LoadAssetAtPath<SceneAsset>(original);
                SessionState.EraseBool(ChangedKey); SessionState.EraseString(OriginalKey);
            }
            var restart = SessionState.GetString(RestartKey, "");
            if (restart == "") return;
            SessionState.EraseString(RestartKey);
            EditorApplication.delayCall += () => { try { Start(restart); } catch (Exception ex) { fail(ex.Message); } };
        }

        public static void CancelRestart() => SessionState.EraseString(RestartKey);
    }
}
