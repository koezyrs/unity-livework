using System;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace LiveWork.Editor
{
    [Serializable] public class SceneInfo { public string path, name; public bool inBuild; }
    [Serializable] public class SceneList { public int v = 1; public string type = "scenes"; public SceneInfo[] scenes; public bool truncated; }

    /// <summary>Lists project scenes and plays a chosen scene without opening it in the Editor.</summary>
    public static class LiveWorkScenes
    {
        const int Limit = 2000;
        const string OriginalKey = "LiveWork.StartScene.Original", ChangedKey = "LiveWork.StartScene.Changed", RestartKey = "LiveWork.RestartScene", PlayedKey = "LiveWork.PlayedScene";
        static bool dirty = true;
        static double nextCheck;
        static string lastJson;

        public static bool Restarting => SessionState.GetString(RestartKey, "") != "";
        public static string StartScene => EditorSceneManager.playModeStartScene ? AssetDatabase.GetAssetPath(EditorSceneManager.playModeStartScene) : "";

        /// <summary>The scene that Play runs: the chosen start scene, or the active Editor scene.</summary>
        public static string Current => StartScene != "" ? StartScene : EditorApplication.isPlaying ? SessionState.GetString(PlayedKey, "") : SceneManager.GetActiveScene().path;

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

        /// <summary>Makes Play run the scene. Unity's Play button uses it too until <see cref="Restore"/>.</summary>
        public static void Select(string path)
        {
            var scene = Find(path);
            if (!SessionState.GetBool(ChangedKey, false)) { SessionState.SetString(OriginalKey, StartScene); SessionState.SetBool(ChangedKey, true); }
            EditorSceneManager.playModeStartScene = scene;
        }

        /// <summary>Restarts Play Mode in the scene.</summary>
        public static void Restart(string path)
        {
            if (!EditorApplication.isPlaying) throw new InvalidOperationException("Play first");
            Find(path);
            SessionState.SetString(RestartKey, path); EditorApplication.isPlaying = false;
        }

        public static void OnExitingEditMode() => SessionState.SetString(PlayedKey, SceneManager.GetActiveScene().path);

        /// <summary>Continues a pending restart.</summary>
        public static void OnEnteredEditMode(Action<string> fail)
        {
            var restart = SessionState.GetString(RestartKey, "");
            if (restart == "") return;
            SessionState.EraseString(RestartKey);
            EditorApplication.delayCall += () => { try { Select(restart); EditorApplication.isPlaying = true; } catch (Exception ex) { fail(ex.Message); } };
        }

        /// <summary>Gives the user back their own start scene when the LiveWork session ends.</summary>
        public static void Restore()
        {
            SessionState.EraseString(RestartKey);
            if (!SessionState.GetBool(ChangedKey, false)) return;
            var original = SessionState.GetString(OriginalKey, "");
            EditorSceneManager.playModeStartScene = original == "" ? null : AssetDatabase.LoadAssetAtPath<SceneAsset>(original);
            SessionState.EraseBool(ChangedKey); SessionState.EraseString(OriginalKey);
        }
    }
}
