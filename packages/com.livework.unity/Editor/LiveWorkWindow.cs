using System;
using System.IO;
using Net.Codecrete.QrCodeGenerator;
using UnityEditor;
using UnityEngine;

namespace LiveWork.Editor
{
    public sealed class LiveWorkWindow : EditorWindow
    {
        Texture2D qr;
        string qrPayload, localError;
        double copiedUntil;
        Vector2 scroll;
        static readonly string[] QrTargets = { "Browser", "Android app" };
        static bool QrForApp { get => EditorPrefs.GetBool("LiveWork.QrForApp", false); set => EditorPrefs.SetBool("LiveWork.QrForApp", value); }

        [MenuItem("Window/LiveWork")]
        public static void Open() => GetWindow<LiveWorkWindow>("LiveWork");
        void OnEnable() { minSize = new Vector2(300, 420); }
        void OnDisable() { ClearQr(); }
        void OnInspectorUpdate() => Repaint();
        void ClearQr() { if (qr != null) DestroyImmediate(qr); qr = null; qrPayload = null; }

        void UpdateQr(string payload)
        {
            if (qrPayload == payload && qr != null) return;
            ClearQr();
            var matrix = QrCode.EncodeText(payload, QrCode.Ecc.Medium);
            int size = matrix.Size + 8;
            qr = new Texture2D(size, size, TextureFormat.RGBA32, false) { name = "LiveWork pairing QR", filterMode = FilterMode.Point, wrapMode = TextureWrapMode.Clamp, hideFlags = HideFlags.HideAndDontSave };
            var pixels = new Color32[size * size];
            for (int y = 0; y < size; y++)
                for (int x = 0; x < size; x++)
                    pixels[(size - 1 - y) * size + x] = matrix.GetModule(x - 4, y - 4) ? new Color32(0, 0, 0, 255) : new Color32(255, 255, 255, 255);
            qr.SetPixels32(pixels); qr.Apply(false, true); qrPayload = payload;
        }

        void OnGUI()
        {
            scroll = EditorGUILayout.BeginScrollView(scroll);
            using (new EditorGUILayout.VerticalScope(EditorStyles.inspectorDefaultMargins)) {
                GUILayout.Space(8);
                GUILayout.Label("LiveWork", EditorStyles.boldLabel);
                EditorGUILayout.LabelField("Status", LiveWorkHost.ServerStatus);
                GUILayout.Space(8);
                bool ready = LiveWorkHost.ServerReady;
                string url = ready ? LiveWorkHost.BrowserUrl : null;
                EditorGUILayout.LabelField("Address", EditorStyles.miniLabel);
                EditorGUILayout.SelectableLabel(url ?? "Available when the server is ready", EditorStyles.textField, GUILayout.Height(22));
                EditorGUILayout.LabelField("Pairing code", EditorStyles.miniLabel);
                var codeStyle = new GUIStyle(EditorStyles.textField) { fontSize = 22, alignment = TextAnchor.MiddleCenter };
                EditorGUILayout.SelectableLabel(ready ? LiveWorkHost.Config.code : "— — — — — —", codeStyle, GUILayout.Height(36));
                GUILayout.Space(12);
                QrForApp = GUILayout.Toolbar(QrForApp ? 1 : 0, QrTargets) == 1;
                GUILayout.Space(6);
                if (ready) {
                    var pairUrl = url + "/#pair=" + Uri.EscapeDataString(LiveWorkHost.Config.code);
                    // The LiveWork Android app handles livework:// links and opens the page in its own view.
                    try { UpdateQr(QrForApp ? "livework://open?url=" + Uri.EscapeDataString(pairUrl) : pairUrl); }
                    catch (Exception ex) { localError = "QR code could not be created: " + ex.Message; }
                } else if (qr != null) ClearQr();
                var area = GUILayoutUtility.GetRect(0, 156, GUILayout.ExpandWidth(true));
                float edge = qr != null ? Mathf.Floor(156 * EditorGUIUtility.pixelsPerPoint / qr.width) * qr.width / EditorGUIUtility.pixelsPerPoint : 156;
                var rect = new Rect(Mathf.Round((area.center.x - edge / 2) * EditorGUIUtility.pixelsPerPoint) / EditorGUIUtility.pixelsPerPoint, area.y, edge, edge);
                if (ready && qr != null) GUI.DrawTexture(rect, qr, ScaleMode.StretchToFill);
                else GUI.Box(rect, "Start server to connect");
                GUILayout.Space(6);
                if (ready) EditorGUILayout.HelpBox(url.Contains("127.0.0.1") ? "Localhost: this address works on this computer only." : QrForApp ? "Scan with your phone’s camera to open the LiveWork app." : "Scan with your phone’s camera to connect.", MessageType.None);
                GUILayout.Space(8);
                bool canEnd = LiveWorkHost.Enabled || LiveWorkHost.Config != null;
                using (new EditorGUI.DisabledScope(LiveWorkHost.IsStopping || LiveWorkService.IsPreparing || (LiveWorkHost.Enabled && LiveWorkHost.Config == null))) {
                    if (GUILayout.Button(LiveWorkService.IsPreparing ? "Preparing service…" : LiveWorkHost.IsStopping ? "Ending server…" : canEnd ? "End server" : "Start server", GUILayout.Height(28))) {
                        localError = null;
                        if (canEnd) _ = LiveWorkHost.EndServerAsync();
                        else StartServer();
                    }
                }
                using (new EditorGUI.DisabledScope(!ready))
                using (new EditorGUILayout.HorizontalScope()) {
                    if (GUILayout.Button(EditorApplication.timeSinceStartup < copiedUntil ? "Copied" : "Copy URL", GUILayout.Height(24))) {
                        EditorGUIUtility.systemCopyBuffer = url; copiedUntil = EditorApplication.timeSinceStartup + 2;
                    }
                    if (GUILayout.Button("Open browser", GUILayout.Height(24))) Application.OpenURL(url);
                }
                var error = localError ?? LiveWorkHost.ServerError;
                if (!string.IsNullOrEmpty(error)) EditorGUILayout.HelpBox(error, MessageType.Error);
                GUILayout.Space(8);
            }
            EditorGUILayout.EndScrollView();
        }

        async void StartServer()
        {
            try {
                if (!File.Exists(Path.Combine(LiveWorkHost.ServiceDirectory, "server.mjs"))) {
                    var folder = EditorUtility.OpenFolderPanel("Choose the LiveWork service folder", "", "");
                    if (string.IsNullOrEmpty(folder)) return;
                    LiveWorkHost.ServiceDirectory = folder;
                }
                await LiveWorkService.PrepareAsync();
                LiveWorkHost.Enable();
            } catch (Exception ex) { localError = ex.Message; Repaint(); }
        }
    }
}
