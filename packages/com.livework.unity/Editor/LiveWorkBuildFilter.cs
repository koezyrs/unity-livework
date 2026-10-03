using System;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;

namespace LiveWork.Editor
{
    /// <summary>Keeps LiveWork, Render Streaming, and WebRTC out of player builds. LiveWork only streams the Editor Game View.</summary>
    class LiveWorkBuildFilter : IPreprocessBuildWithReport, IFilterBuildAssemblies
    {
        const string WebRtc = "Packages/com.unity.webrtc/", WebSocket = "/ThirdParty/RenderStreaming/Runtime/Plugins/websocket-sharp.dll";
        static readonly string[] Assemblies = { "LiveWork.Runtime.dll", "Unity.RenderStreaming.dll", "Unity.WebRTC.dll" };

        public int callbackOrder => 0;

        // A project that lists com.unity.webrtc in its own manifest uses WebRTC in the game; leave its build alone.
        static bool Strip
        {
            get {
                var info = UnityEditor.PackageManager.PackageInfo.FindForAssetPath(WebRtc + "package.json");
                return info != null && !info.isDirectDependency;
            }
        }

        // The runtime assemblies must compile for every platform, or Unity treats their
        // MonoBehaviours as editor scripts and refuses AddComponent. Remove them here instead.
        public string[] OnFilterAssemblies(BuildOptions options, string[] assemblies) =>
            Strip ? assemblies.Where(path => Array.IndexOf(Assemblies, Path.GetFileName(path)) < 0 && !path.Replace('\\', '/').EndsWith(WebSocket)).ToArray() : assemblies;

        public void OnPreprocessBuild(BuildReport report)
        {
            if (!Strip) return;
            // Native libraries only: websocket-sharp must stay for the player script compile and is
            // filtered above. The delegate lives only in this domain, so no import setting changes.
            foreach (var plugin in PluginImporter.GetAllImporters())
                if (plugin.assetPath.StartsWith(WebRtc)) plugin.SetIncludeInBuildDelegate(_ => false);
        }
    }
}
