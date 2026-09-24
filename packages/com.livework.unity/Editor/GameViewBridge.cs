using System;
using System.Reflection;
using UnityEditor;
using UnityEngine;

namespace LiveWork.Editor
{
    public static class GameViewBridge
    {
        const BindingFlags Flags = BindingFlags.Instance | BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic;
        static readonly Type ViewType = typeof(EditorWindow).Assembly.GetType("UnityEditor.GameView");
        static readonly PropertyInfo RenderSizeProperty = ViewType.GetProperty("targetRenderSize", Flags);
        static readonly FieldInfo TextureField = ViewType.GetField("m_RenderTexture", Flags);
        static EditorWindow view;
        public static EditorWindow View => view != null ? view : view = EditorWindow.GetWindow(ViewType);
        public static Vector2Int Size {
            get { var v = (Vector2)RenderSizeProperty.GetValue(View); return new Vector2Int(Mathf.Max(2, (int)v.x), Mathf.Max(2, (int)v.y)); }
        }
        public static RenderTexture Texture => TextureField.GetValue(View) as RenderTexture;
        static object Group() {
            var type = typeof(EditorWindow).Assembly.GetType("UnityEditor.GameViewSizes");
            var instance = type.BaseType.GetProperty("instance", Flags).GetValue(null);
            var groupType = ViewType.GetProperty("currentSizeGroupType", Flags).GetValue(View);
            return type.GetMethod("GetGroup", Flags).Invoke(instance, new[] { groupType });
        }
        public static void Remember()
        {
            if (SessionState.GetInt("LiveWork.OriginalSize", -1) < 0) SessionState.SetInt("LiveWork.OriginalSize", (int)ViewType.GetProperty("selectedSizeIndex", Flags).GetValue(View));
        }
        public static void Resize(int width, int height)
        {
            Remember();
            RemoveTemporarySize();
            var group = Group();
            var sizeType = typeof(EditorWindow).Assembly.GetType("UnityEditor.GameViewSize");
            var kind = typeof(EditorWindow).Assembly.GetType("UnityEditor.GameViewSizeType");
            var size = Activator.CreateInstance(sizeType, new[] { Enum.ToObject(kind, 1), (object)width, height, "LiveWork Session" });
            group.GetType().GetMethod("AddCustomSize").Invoke(group, new[] { size });
            var index = (int)group.GetType().GetMethod("GetTotalCount").Invoke(group, null) - 1;
            ViewType.GetProperty("selectedSizeIndex", Flags).SetValue(View, index);
            View.Show(); View.Repaint();
        }
        static void RemoveTemporarySize()
        {
            var group = Group(); var type = group.GetType();
            var count = (int)type.GetMethod("GetTotalCount").Invoke(group, null);
            var builtIn = (int)type.GetMethod("GetBuiltinCount").Invoke(group, null);
            for (int i = count - 1; i >= builtIn; i--) {
                var size = type.GetMethod("GetGameViewSize").Invoke(group, new object[] { i });
                if ((string)size.GetType().GetProperty("baseText").GetValue(size) == "LiveWork Session") type.GetMethod("RemoveCustomSize").Invoke(group, new object[] { i });
            }
        }
        public static void Restore()
        {
            var index = SessionState.GetInt("LiveWork.OriginalSize", -1);
            if (index < 0) return;
            RemoveTemporarySize();
            ViewType.GetProperty("selectedSizeIndex", Flags).SetValue(View, index);
            SessionState.EraseInt("LiveWork.OriginalSize"); View.Repaint();
        }
    }
}
