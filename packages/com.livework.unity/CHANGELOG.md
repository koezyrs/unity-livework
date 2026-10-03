# Changelog

All notable changes to this package are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Installing the package no longer adds WebRTC and Render Streaming to player
  builds. A build step removes the LiveWork, Render Streaming, and WebRTC
  assemblies and the native WebRTC library from the build. If your game uses
  WebRTC itself, add `com.unity.webrtc` to your project's `Packages/manifest.json`
  and LiveWork leaves the build unchanged.
- Touch input is no longer silently dropped when the connection is slow. Only
  merged movement updates are shed while the data channel is congested; touch
  down/up/cancel, key presses, and heartbeats are always delivered in order, so
  gestures no longer vanish or leave a stuck touch in the game.
- A touch that starts just outside the video area (letterbox bars) is clamped
  into the game instead of ignoring the whole gesture.
- After Play, resolution, or quality changes recreate the stream, the Editor
  republishes its state as soon as it sees input for the older stream, so the
  browser resynchronizes within one round trip instead of dropping input for up
  to half a second.
- An Editor stall that overflows the input queue now cancels held touches and
  sheds the backlog while keeping the channel working, and games no longer see
  a finger whose phase jumps to Moved/Ended without a Began.
- The Unity Editor no longer keeps encoding, repainting, and draining native
  WebRTC work while no viewer is connected. The service now tells the Editor
  when a controller arrives and leaves; an idle Editor keeps the session alive
  but suspends capture, so long sessions do not grow memory for nobody.
- Repeated stream restarts (Play Mode reloads, quality changes, reconnects) no
  longer pile up stopped signaling instances in a static Render Streaming set
  until garbage collection runs.

## [1.1.0] - 2026-09-25

### Added

- **Scenes** tab in the web menu. Search every scene in the project. A
  **Current** tag marks the scene that Play will run. When the game is stopped,
  tap a scene to make it current, then press Play. When the game is running,
  LiveWork asks, then restarts Play Mode in the chosen scene. The scene is not
  opened in the Editor, and your Play Mode start scene is restored when you end
  the server.
- **Console** tab in the web menu. It shows Editor and game logs, including
  compile errors, with stack traces. You can filter Info, Warning, and Error
  logs, search, and copy one log. A red dot on the menu button means a new
  error arrived. The service keeps the last 500 logs for reconnects.

### Changed

- The web menu button is now named **Menu** and has three tabs: Scenes,
  Console, and Settings.
- Debug builds of the Android app install next to the release app as
  **LiveWork Dev**.

### Fixed

- Unity no longer logs `Failed to set remote answer sdp: Called in wrong state:
  stable` when a slow device answers a resent offer twice. The connection was
  not affected, but the error showed as a false alarm in the console.
- The Android app centers the Connecting text and the server address on its
  loading screen.

## [1.0.0] - 2026-09-25

### Added

- **Connection Mode** in the Unity window: **LAN**, **Tailscale**, or
  **ZeroTier**, each with its logo. The service accepts only localhost and the
  chosen network. You can change the mode only while the server is stopped.

### Changed

- The Web/Android QR code choice in the Unity window is now named **QRCode**.
- Connection error messages in the web client and the Android app no longer
  mention only Tailscale.

## [0.2.0] - 2026-09-25

### Added

- **LiveWork Android app.** Scan the QR code in the Unity window or type the
  address, then play in full screen. The app keeps the screen on, stays clear of
  the camera cutout, shows a loading screen while it connects, and opens
  `livework://` links from the phone's camera app. The APK is attached to each
  GitHub release.
- **Stream quality presets:** Smooth (best on mobile data), Balanced, and Sharp.
  You can change the preset while the stream is running.
- **Settings screen** in the web client, opened with the ☰ button. It has the
  Game resolution dropdown and the stream quality presets.
- **Connection Mode** in the Unity window: **Web** or **Android**. The QR code
  changes at once.
- Status indicator with a colored dot in the Unity window.
- New LiveWork logo for the Unity window, the web client, and the Android app.

### Changed

- Prefer H.264 hardware encoding (NVIDIA NVENC when available). The default
  maximum bitrate is now 4 Mbps, which works better on mobile networks.
- The browser shows video frames at once, with no extra jitter buffer delay.
- Pointer and touch moves are sent at most once per frame, so input stays
  responsive on slow networks.
- Status messages now describe one exact state, for example
  "Unity is starting Play Mode…".
- The web client opens the game view directly when the pairing code comes from
  the QR code. It no longer shows the pairing form first.
- Unity window layout: **Copy** and **Open** sit next to the address, and
  **Start server** / **End server** is at the bottom.
- Buttons no longer flash a highlight color when you tap them.

### Fixed

- The Editor stalled every 0.5 seconds because it read `ProjectSettings.asset`
  again and again.
- The capture rate drifted below the target frame rate.
- The Game View was repainted more often than needed.
- The Game resolution list flickered while it was open on Android.

## 0.1.0 - 2026-09-20

### Added

- First preview. It was not published as a GitHub release.
- Stream the Game View video and audio to a phone or PC browser over WebRTC.
- Touch, mouse, and keyboard input without changes to game scripts.
- Play/Stop, Pause/Resume, and Step controls.
- Game View resolution presets and custom sizes.
- Six-digit pairing code and QR code pairing.
- Session recovery after reloads, Play Mode changes, and domain reloads.
- One Git URL installation with the patched Render Streaming runtime and the web
  service included.

[1.1.0]: https://github.com/koezyrs/unity-livework/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/koezyrs/unity-livework/compare/v0.2.0...v1.0.0
[0.2.0]: https://github.com/koezyrs/unity-livework/releases/tag/v0.2.0
