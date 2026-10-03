# Unity Render Streaming

Source: https://github.com/Unity-Technologies/UnityRenderStreaming
Commit: `d4e8dc834f67cb4de920e3168b9db50141693052`
Package: `3.1.0-exp.9`; WebRTC: `3.0.0-pre.8`.

LiveWork overrides the WebRTC dependency with registry version `3.0.0` for Unity 6.

The original license and third-party notices are retained in the package.

## Local compatibility patch

`com.unity.renderstreaming/Editor/RenderStreamingWizard.cs`: use Android API 25
on Unity 6000.3+, API 23 on 6000.2, retaining upstream branches on earlier Editors. Unity
6000.3.11f1 and 6000.2.7f2 reject the upstream AndroidApiLevel22 reference with CS0619 even
when the active build target is Windows. No streaming behavior is changed.

`Runtime/RenderStreamingSettings.asset`: disable the default automatic streaming
bootstrap. LiveWork owns the explicit opt-in lifecycle; installing the package
must not start an unauthenticated stream on every Play. Existing project-specific
Render Streaming settings are not changed.

`SignalingManager.cs` and `SignalingHandlerBase.cs`: optional per-instance coroutine
scheduler delegates. Defaults remain upstream behavior. LiveWork drives signaling,
track creation and encoding from Editor ticks so pause, frame stepping, resizing
and reconnect do not require advancing gameplay.

`PeerConnection.cs`: ignore an answer that arrives when no local offer is pending.
The signaling manager resends an unanswered offer every five seconds, and a slow
browser answers both copies. The first answer completes negotiation; upstream then
tried to apply the second one and logged `Called in wrong state: stable`. The
connection was not affected, but the error reached the LiveWork web console as a
false alarm. Offers and valid answers keep upstream behavior.

`service/upstream` contains unmodified signaling handler/types from WebApp;
`service/public/upstream` contains unmodified browser RenderStreaming/Peer/logger
modules. The LiveWork server wraps signaling with pairing and single-controller
authorization. Original license files accompany both copies.

## Single-package installation

The patched runtime is bundled in LiveWork's `ThirdParty/RenderStreaming` by
`service/scripts/bundle-renderstreaming.mjs`. Its default asset path is rewritten
for the containing package, and asset GUIDs plus serialized references receive
stable LiveWork-specific identities. No separate Render Streaming package is required.
Installing both would duplicate assemblies; the upstream Editor wizard and
sample projects are intentionally not included in the LiveWork package.

`RenderStreaming.cs` also tolerates a missing settings asset during first import
or migration, before the Package Manager finishes importing the bundled asset.
