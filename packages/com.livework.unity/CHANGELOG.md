# Changelog

All notable changes to this package are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.2.0]: https://github.com/koezyrs/unity-livework/releases/tag/v0.2.0
