#if UNITY_EDITOR
using System;
using System.Linq;
using System.Text;
using Unity.RenderStreaming;
using Unity.WebRTC;
using UnityEngine;
using UnityEngine.Experimental.Rendering;

namespace LiveWork
{
    // Editor creates this transient object after entering Play Mode. Never saved in a scene/build.
    public sealed class LiveWorkStream : MonoBehaviour
    {
        public static Action<string> InputReceived;
        public static Action InputDisconnected;
        SignalingManager manager;
        RenderTexture texture;
        AudioStreamSender audioSender;
        AudioListener listener;
        double nextListenerSearch;
        StreamingScheduler scheduler;
        public RenderTexture Texture => texture;

        public void Initialize(string signalingUrl, int width, int height, uint maxBitrate)
        {
            scheduler = new StreamingScheduler(this);
            texture = new RenderTexture(width, height, 0) {
                graphicsFormat = WebRTC.GetSupportedGraphicsFormat(SystemInfo.graphicsDeviceType),
                name = "LiveWork Game View", hideFlags = HideFlags.HideAndDontSave
            };
            texture.Create();
            var broadcast = gameObject.AddComponent<Broadcast>();
            broadcast.coroutineStartOverride = scheduler.Start;
            var video = gameObject.AddComponent<VideoStreamSender>();
            video.source = VideoStreamSource.Texture;
            video.sourceTexture = texture;
            video.SetTextureSize(new Vector2Int(width, height));
            video.SetFrameRate(30);
            video.SetBitrate(Math.Min(500u, maxBitrate), maxBitrate);
            var h264 = PreferredCodec();
            if (h264 != null) video.SetCodec(h264);
            broadcast.AddComponent(video);
            audioSender = gameObject.AddComponent<AudioStreamSender>();
            audioSender.source = AudioStreamSource.AudioListener;
            RefreshAudio();
            // Audio track is attached only if there is an actual listener in the game.
            if (listener != null) broadcast.AddComponent(audioSender);
            broadcast.AddComponent(gameObject.AddComponent<LiveWorkInputChannel>());
            manager = gameObject.AddComponent<SignalingManager>();
            manager.runOnAwake = false;
            manager.coroutineStartOverride = scheduler.Start;
            manager.coroutineStopOverride = scheduler.Stop;
            manager.evaluateCommandlineArguments = false;
            manager.useDefaultSettings = false;
            manager.SetSignalingSettings(new WebSocketSignalingSettings(signalingUrl, Array.Empty<IceServer>()));
            manager.AddSignalingHandler(broadcast);
            manager.Run(new RTCConfiguration { iceServers = Array.Empty<RTCIceServer>() });
        }

        // H264 can use the GPU encoder on the host and the hardware decoder on phones.
        // Constrained Baseline is the profile every Android Chrome decoder accepts.
        static VideoCodecInfo PreferredCodec()
        {
            var codecs = VideoStreamSender.GetAvailableCodecs().Where(c => c.mimeType == "video/H264").ToArray();
            return codecs.FirstOrDefault(c => c.sdpFmtpLine != null && c.sdpFmtpLine.Contains("profile-level-id=42e0") && c.sdpFmtpLine.Contains("packetization-mode=1"))
                ?? codecs.FirstOrDefault(c => c.sdpFmtpLine != null && c.sdpFmtpLine.Contains("packetization-mode=1"))
                ?? codecs.FirstOrDefault();
        }

        public void RefreshAudio()
        {
            if (listener != null && listener.isActiveAndEnabled) return;
            if (UnityEditor.EditorApplication.timeSinceStartup < nextListenerSearch) return;
            nextListenerSearch = UnityEditor.EditorApplication.timeSinceStartup + 1;
            var current = FindFirstObjectByType<AudioListener>();
            if (current == listener) return;
            listener = current;
            if (listener != null) audioSender.audioListener = listener;
        }

        public void Tick() { Unity.WebRTC.WebRTC.ExecutePendingTasks(2); scheduler?.Tick(); }

        void OnDestroy()
        {
            scheduler?.Dispose();
            if (manager != null) manager.Stop();
            InputDisconnected?.Invoke();
            // Destroy texture after stream components release their tracks.
            if (texture != null) Destroy(texture);
        }
    }

    public sealed class LiveWorkInputChannel : DataChannelBase
    {
        protected override void OnMessage(byte[] bytes)
        {
            if (bytes.Length <= 8192) LiveWorkStream.InputReceived?.Invoke(Encoding.UTF8.GetString(bytes));
        }
        protected override void OnClose(string id) { LiveWorkStream.InputDisconnected?.Invoke(); base.OnClose(id); }
    }
}
#endif
