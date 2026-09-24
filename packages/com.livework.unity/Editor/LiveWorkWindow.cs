using System;
using System.IO;
using Net.Codecrete.QrCodeGenerator;
using UnityEditor;
using UnityEngine;

namespace LiveWork.Editor
{
    public sealed class LiveWorkWindow : EditorWindow
    {
        const float QrEdge = 168;
        Texture2D qr, dot;
        string qrPayload, localError;
        double copiedUntil;
        Vector2 scroll;
        static readonly string[] QrTargets = { "Browser", "Android app" };
        static bool QrForApp { get => EditorPrefs.GetBool("LiveWork.QrForApp", false); set => EditorPrefs.SetBool("LiveWork.QrForApp", value); }

        [MenuItem("Window/LiveWork")]
        public static void Open() => GetWindow<LiveWorkWindow>("LiveWork");
        void OnEnable() { minSize = new Vector2(300, 420); }
        void OnDisable() { ClearQr(); if (dot != null) DestroyImmediate(dot); dot = null; }
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
                StatusRow();
                GUILayout.Space(8);
                bool ready = LiveWorkHost.ServerReady;
                string url = ready ? LiveWorkHost.BrowserUrl : null;
                EditorGUILayout.LabelField("Address", EditorStyles.miniLabel);
                EditorGUILayout.SelectableLabel(url ?? "Available when the server is ready", EditorStyles.textField, GUILayout.Height(22));
                EditorGUILayout.LabelField("Pairing code", EditorStyles.miniLabel);
                var codeStyle = new GUIStyle(EditorStyles.textField) { fontSize = 22, alignment = TextAnchor.MiddleCenter };
                EditorGUILayout.SelectableLabel(ready ? LiveWorkHost.Config.code : "— — — — — —", codeStyle, GUILayout.Height(36));
                GUILayout.Space(12);
                QrForApp = EditorGUILayout.Popup("QR code opens", QrForApp ? 1 : 0, QrTargets) == 1;
                GUILayout.Space(6);
                if (ready) {
                    var pairUrl = url + "/#pair=" + Uri.EscapeDataString(LiveWorkHost.Config.code);
                    // The LiveWork Android app handles livework:// links and opens the page in its own view.
                    try { UpdateQr(QrForApp ? "livework://open?url=" + Uri.EscapeDataString(pairUrl) : pairUrl); }
                    catch (Exception ex) { localError = "QR code could not be created: " + ex.Message; }
                } else if (qr != null) ClearQr();
                DrawQr(ready);
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

        /// <summary>Draws the QR code in a white square that keeps the same size for every payload.</summary>
        void DrawQr(bool ready)
        {
            float ppp = EditorGUIUtility.pixelsPerPoint;
            var area = GUILayoutUtility.GetRect(0, QrEdge, GUILayout.ExpandWidth(true));
            var box = new Rect(Mathf.Round((area.center.x - QrEdge / 2) * ppp) / ppp, Mathf.Round(area.y * ppp) / ppp, QrEdge, QrEdge);
            if (!ready || qr == null) { GUI.Box(box, "Start server to connect"); return; }
            EditorGUI.DrawRect(box, Color.white);
            // Whole pixels per module keep the code sharp; the white square absorbs the rest.
            float edge = Mathf.Floor(QrEdge * ppp / qr.width) * qr.width / ppp;
            var rect = new Rect(Mathf.Round((box.center.x - edge / 2) * ppp) / ppp, Mathf.Round((box.center.y - edge / 2) * ppp) / ppp, edge, edge);
            GUI.DrawTexture(rect, qr, ScaleMode.StretchToFill);
        }

        void StatusRow()
        {
            var color = LiveWorkService.IsPreparing || LiveWorkHost.IsStopping ? new Color(0.95f, 0.7f, 0.2f)
                : LiveWorkHost.ServerError != null ? new Color(0.93f, 0.33f, 0.3f)
                : LiveWorkHost.ServerReady ? new Color(0.3f, 0.8f, 0.4f)
                : LiveWorkHost.Enabled ? new Color(0.95f, 0.7f, 0.2f)
                : new Color(0.55f, 0.55f, 0.55f);
            using (new EditorGUILayout.HorizontalScope()) {
                var icon = GUILayoutUtility.GetRect(10, 18, GUILayout.Width(10));
                var previous = GUI.color; GUI.color = color;
                GUI.DrawTexture(new Rect(icon.x, icon.center.y - 5, 10, 10), Dot());
                GUI.color = previous;
                GUILayout.Space(4);
                GUILayout.Label(LiveWorkHost.ServerStatus, EditorStyles.label);
                GUILayout.FlexibleSpace();
            }
        }

        /// <summary>A small white circle, tinted per status.</summary>
        Texture2D Dot()
        {
            if (dot != null) return dot;
            const int size = 32;
            dot = new Texture2D(size, size, TextureFormat.RGBA32, false) { name = "LiveWork status dot", hideFlags = HideFlags.HideAndDontSave };
            var pixels = new Color32[size * size];
            for (int y = 0; y < size; y++)
                for (int x = 0; x < size; x++) {
                    float distance = Vector2.Distance(new Vector2(x + 0.5f, y + 0.5f), new Vector2(size / 2f, size / 2f));
                    pixels[y * size + x] = new Color32(255, 255, 255, (byte)(Mathf.Clamp01(size / 2f - distance) * 255));
                }
            dot.SetPixels32(pixels); dot.Apply(false, true);
            return dot;
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
