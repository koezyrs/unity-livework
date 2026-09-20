# Verification — 2026-09-20

## UI and single-URL packaging refresh

The refreshed web UI and bundled installation were checked on Windows with
Unity 6000.3.11f1, Node 22.20.0, and Edge/Playwright:

- Four service tests passed, including token-protected shutdown, disconnected
  clients, and reuse of the released port.
- Browser UI checks passed for code/QR pairing, invalid codes, exclusive control,
  Play/Stop/Pause/Resume/Step, preset/custom resolutions, mute and fullscreen.
- Desktop, landscape and 320 px layouts passed overflow/touch-target checks.
  Transport controls are centered on desktop; settings align right on the same row.
- Live Unity workflow passed video/audio, keyboard, mouse, uGUI, multi-touch,
  exact single-frame stepping, resolution changes and browser/Play reconnection.
- Recovery passed paused resize/reconnect, scene reload, compile/domain reload,
  compile failure protection and recovery after fixing code.
- A clean Unity project installed from **one local Git URL** using the same UPM
  package-path layout as the documented GitHub URL. Registry dependencies resolved
  without a separate Render Streaming package. The bundled service prepared under
  Library, and Start → End → Start → End succeeded.
- End/Start in the live sample preserved Play Mode. A subsequent audio check
  measured RMS 0.0251, with no browser JavaScript errors.
- Both generated bundle checks and `git diff --check` passed.

This does not verify a GitHub release: the working-tree changes must still be
committed and pushed. Editor screenshot capture was unavailable because the
Windows capture helper returned `SetIsBorderRequired: No such interface supported`.
The Editor code compiled and ran; web screenshots were reviewed directly.
Physical Android acceptance remains outstanding as described below.

The sections below also retain evidence from the earlier preview verification.

## Tested environment

Windows host, graphics-enabled Unity Editors **6000.3.11f1** and **6000.2.7f2**,
Node **22.20.0**, Edge/Chromium through Playwright. Render Streaming
**3.1.0-exp.9**, upstream commit `d4e8dc834f67cb4de920e3168b9db50141693052`,
with the explicit patches in `vendor/UPSTREAM.md`; WebRTC **3.0.0** and
Input System **1.17.0**. The integration sample uses Active Input Handling Both.

## Passed

- Three Node tests: pairing/origin checks, exclusive controller, validated
  commands and response correlation, disconnect handling, letterboxed coordinates.
- Both Editor versions: received Game View video and audio tracks; remote
  keyboard down/up, mouse down/up and uGUI click exactly once.
- Two simultaneous browser touches observed by both `Touchscreen` and
  `Input.touchCount`, followed by release. Touch UI click fires exactly once.
- Pause freezes gameplay; Next Frame advances the sample counter exactly one
  frame. Video reconnect and resolution change also work while paused without
  advancing gameplay.
- Portrait 720×1280 and landscape 1280×720 render sizes, browser reload,
  Stop/Play, scene replacement, script compile/domain reload reconnect.
- Deliberately invalid sample code prevents Play success; fixing it restores
  operation. Disconnect clears a held key. No browser JavaScript errors.
- A separate media check used the host's Tailscale HTTP address. Received audio
  samples had RMS **0.0252** (not merely an empty audio track). One local sample
  reported **24 FPS, 0.8 Mbps, 0 ms ICE RTT** at 1280×720. These are local
  observations, not internet performance or input-to-display latency promises.

Machine-local evidence is under `.artifacts/`: per-version workflow/recovery
reports, Unity logs and desktop/mobile-layout screenshots. Raw debug artifacts
are deliberately excluded from version control.

## Legacy boundary established by execution

On 6000.3.11f1, `QueueGameViewInputEvent`/`GameView.SendEvent` produce OnGUI
key events, but **do not update** `GetKey`, key down/up, mouse down/up/held or
configured axes. The internal `Input.SimulateTouch` path does produce multiple
touches and ended phases. This is the reason Legacy support is touch-only.
Input System uses virtual devices that can run without desktop focus; gameplay
code is unchanged. Input behavior tied to custom action/device filters still
needs project-specific verification.

## Remaining acceptance work

- Physical Android Chrome on another internet connection with Tailscale:
  real multi-finger dragging, network switching, firewall traversal, audio,
  orientation changes and measured latency. Browser CDP touch is not hardware.
- Separate Legacy-only and Input-System-only project configurations; current
  end-to-end tests run Both. Legacy polling was independently probed.
- Project-specific UI dragging/scrolling, pointer lock, custom action maps and
  device pairing; these are implemented but not exhaustively acceptance-tested.
- Lock/sleep/minimize behavior, iOS, IME, gamepads, TURN and public internet
  are outside this preview's supported scope.

This is a working preview, not completion of the physical-device acceptance matrix.

## Installed project

Installed into `E:/WORK/SquishyDumpling/SquishyDumpling_Unity/SquishyDumpling`
using local package references in `Packages/manifest.json`. Unity remains
**6000.2.7f2**, Active Input Handling remains Both. Dependency resolution upgrades
Input System from **1.14.2** to **1.17.0** and adds Render Streaming/WebRTC.
Keep the LiveWork repository at its current path for these local references.

Through the project's Funplay Unity MCP workflow, verified compilation, launched
from `Assets/ProjectSettings/Scenes/SceneSplash.unity`, and received the actual
game image in a 412×915 browser viewport via the host Tailscale address. Stream:
**640×1136**, audio/video tracks, **22 FPS / 1.2 Mbps / 0 ms RTT** in that local
sample, no browser JavaScript errors or recent Unity Console errors. Audio energy
was measured in the isolated sample, not in this project. No gameplay buttons
were clicked during this installation smoke test.

Returned to Edit Mode and restored `Assets/Scenes/DiyDumplingsScene.unity`.
LiveWork remains enabled. Changes made to the project are the package manifest
and Unity-generated lockfile; no gameplay, scene or prefab edits were made.
Use the normal SceneSplash startup flow when testing the whole game remotely.
Evidence: `.artifacts/installed-project.png` and `installed-report.json`.
