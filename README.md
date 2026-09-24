# Unity LiveWork

Play your Unity Editor's Game View from an Android or desktop browser.

LiveWork streams video and audio over WebRTC and sends touch, mouse, and keyboard
input back to your game. A compact, single-row web toolbar controls Play Mode,
pause, frame stepping, resolution, sound, and fullscreen.

**Development preview · Windows host · Unity 6 · Tailscale or localhost**

## Features

- **One Git URL installation.** Includes the patched Render Streaming runtime and
  web service. Unity resolves the remaining package dependencies automatically.
- **Code or QR pairing.** Enter the six-digit code, or scan the Editor's QR code
  with your phone's camera to open and pair the browser.
- **Unity-style controls.** Play/Stop, Pause/Resume, and Step.
- **Game-first web UI.** One compact toolbar above the Game View, with a black and
  silver theme. The Editor window uses standard Unity controls.
- **Real Game View resolution.** Choose a preset or enter custom dimensions.
- **Video, audio, and input.** Stream the game without changing gameplay scripts.
- **Session recovery.** Reconnect after browser reload, Stop/Play, scene changes,
  and Unity script/domain reloads.
- **Per-project service.** Each Editor project uses its own configuration and port.

## Requirements

| Component | Supported configuration |
| --- | --- |
| Host OS | Windows |
| Unity Editor | **6000.3.11f1** or **6000.2.7f2**; other versions are rejected by this preview |
| Node.js | **22 or newer**, including npm, available on PATH |
| Git | Installed and available to Unity Package Manager |
| Network | Tailscale on both devices, or localhost on the host |
| Browser | Chrome on Android; Chrome or Edge on desktop |
| Audio | An active AudioListener in the game |
| Keyboard/mouse input | Active Input Handling set to **Input System** or **Both** |

Node.js, Git, and Tailscale are host applications, not Unity packages. Install them
before starting LiveWork. Restart Unity after installing Node.js so it receives
the updated PATH.

## Installation

### Unity Package Manager — one Git URL

1. Open **Window → Package Manager**.
2. Select **+ → Install package from git URL**.
3. Paste:

   ```text
   https://github.com/koezyrs/unity-livework.git?path=/packages/com.livework.unity
   ```

4. Wait for Unity to resolve dependencies and finish compiling.
5. Open **Window → LiveWork**.

**No second Git URL or separate Render Streaming installation is needed.**
The package contains the patched Render Streaming runtime and web service.
Unity installs WebRTC, Input System, uGUI, and the required Unity modules.

Append `#<commit-sha>` to pin a revision. New changes become available through the
GitHub URL after they are committed and pushed.

### Upgrading from the original two-package setup

Remove the separate `com.unity.renderstreaming` entry from the project's
`Packages/manifest.json` before installing this version. LiveWork now contains
that runtime; installing both creates duplicate assemblies.

If your project uses Render Streaming independently, review the migration before
removing it. This preview does not support a second standalone Render Streaming
package alongside the bundled runtime.

### Local development installation

Clone this repository, then run from its root:

```powershell
.\scripts\setup.ps1
```

Open the included `sample` project, or use **Install package from disk** and select
`packages/com.livework.unity/package.json` in an existing project. Do not install
the package under `vendor` separately.

## Quick start

1. Open your game scene in Unity.
2. Open **Window → LiveWork** and click **Start server**.
3. On the first start, LiveWork prepares its Node dependencies. An npm network
   connection is required.
4. Once the status reads **Server running**, open the displayed address on your
   browser and enter the pairing code. Alternatively, scan the QR code with your
   phone's camera to open and pair automatically.
5. Press **Play** in the web toolbar, then click or touch the Game View.

For a remote device, both devices must be on the same Tailscale network. A
`127.0.0.1` address works only on the host computer; the Editor displays a reminder
when no Tailscale address is available.

Only one browser tab can control an Editor session at a time.

## Controls

### Unity Editor window

The window displays the server status, address, pairing code, and QR code.

| Control | Action |
| --- | --- |
| Start server | Prepare and start the project's LiveWork service |
| End server | Disconnect LiveWork and shut down that service; leave Unity's Play Mode unchanged |
| Copy URL | Copy the browser address without the pairing code |
| Open browser | Open the address in the host's browser |

A new server session generates a new pairing code. Ending a session restores the
previous Game View selection and run-in-background setting.

### Browser toolbar

| Control | Action |
| --- | --- |
| Play / Stop | Enter or exit Unity Play Mode |
| Pause / Resume | Pause gameplay or continue running |
| Step | Advance one Editor frame while paused |
| Sound | Toggle audio; playback starts muted |
| Fullscreen | Show only the game and a small exit button |
| Menu (☰) | Open **Settings**: game resolution and stream quality |
| Right-click the game | Open **Lock pointer** on supported desktop browsers |

In **Settings**, pick a game resolution from the list and it applies immediately.
Choose **Custom size…** to type a width and height, then press Apply. For stream
quality, pick **Smooth** on mobile data, **Balanced** for most networks, and
**Sharp** on fast Wi-Fi. Press Escape or × to close Settings.

All controls share one row. On narrow screens, secondary branding and status text
are hidden to preserve touch targets and game space. The game retains its aspect
ratio; black margins are not new touch targets.

Resolution changes affect the actual Game View, not just its browser display.
Each dimension must be even and between **240 and 1920**, with at most
**2,073,600 pixels** in total.

## Input support

| Unity input backend | Supported input |
| --- | --- |
| Input System | Multi-touch, mouse, scrolling, keyboard, pointer lock |
| Legacy Input Manager | Touch only |
| Both | Input System input plus Legacy touch |

Legacy keyboard, mouse, and axes are not supported. LiveWork does not change
Active Input Handling, action maps, scene input modules, or gameplay scripts.
Custom device filters and action-map bindings may need project-specific testing.

## Networking and service lifecycle

- Editor-started services use an available port per project. Copy the current
  address rather than assuming port 8080.
- Git-installed service files run from `Library/LiveWork/service-<hash>`.
  Dependencies and runtime data stay outside the immutable UPM package cache.
- Host configuration lives in `Library/LiveWork/host.json`. It contains local
  credentials and should not be committed.
- HTTP and WebSocket access is restricted to localhost and Tailscale addresses.
  Pairing is required before browser control or signaling.
- WebRTC sends media and input directly between devices. No public STUN or TURN
  service is configured.
- Tailscale ACLs and the firewall must permit the service's TCP port and WebRTC
  UDP traffic. LiveWork does not modify firewall or network settings.

This preview is intended for private Tailscale or local use, not public internet
hosting. QR pairing uses the phone's camera; the web page does not request camera
access.

For service development, `npm start` in `service` runs a standalone service on
port 8080. `LIVEWORK_PORT` and `LIVEWORK_BIND` override its port and bind address.
`LIVEWORK_STATE_DIRECTORY` overrides its configuration directory; the manual
default is `service/.local`. Editor sessions use their own configuration and do
not attach to an unrelated standalone server.

## Android app

The `android` folder contains a small Android app that shows the same web client
full screen, without the browser's address bar, and keeps the screen on. The
phone still needs Tailscale to reach the host. Build and install it as described in
[android/README.md](android/README.md). In the Unity **LiveWork** window, set
**QR code opens** to **Android app** so the phone's camera opens the app directly.
The app's own scanner reads both QR types.

## Performance tips

- **Check the Tailscale path.** Run `tailscale ping <phone-name>` on the host. If it
  reports `via DERP`, traffic goes through a relay server and adds a lot of delay.
  A `direct` connection is much faster. Mobile networks with strict NAT often
  force DERP; try another network or allow UDP port 41641 on the host firewall.
- **Use Smooth quality on mobile data.** A lower bitrate avoids packet loss, which
  shows up as stutter and late touches.
- **Stop Unity from slowing down in the background.** In **Edit → Preferences →
  General**, set **Interaction Mode** to **No Throttling**.
- **Use an NVIDIA GPU when possible.** LiveWork prefers H264, which Unity encodes
  on NVIDIA GPUs. Other hosts fall back to a CPU encoder, which is slower.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Start server fails | Install Node.js 22+ with npm, restart Unity, and check the inline error |
| First-time preparation fails | Check npm connectivity and registry/proxy settings, then retry |
| Phone cannot open the URL | Connect both devices to Tailscale; do not use localhost on the phone |
| Another browser is controlling Unity | Close the existing controlling tab, then connect again |
| QR or pairing code is rejected | Use the current code; restarting the server changes it |
| Duplicate Render Streaming assembly | Remove the old standalone `com.unity.renderstreaming` dependency |
| Game ignores keyboard/mouse | Use Input System or Both and check action/device bindings |
| No audio | Check the scene's AudioListener and tap the sound icon |
| Play is blocked | Fix compile errors in Unity's Console |
| Pointer lock/fullscreen unavailable | Use a supported browser; some features require HTTPS or a user gesture |
| Video is waiting or reconnecting | Keep Unity and Game View active; check the network and Unity Console |

## Limitations

- Supported Editor versions are deliberately pinned in this preview.
- Streaming targets **30 FPS**. The **Stream quality** setting sets the stream cap:
  Smooth (960 pixels on the longest edge, 2.5 Mbps), Balanced (1280 pixels,
  4 Mbps, default) or Sharp (1280 pixels, 8 Mbps). A higher Game View resolution
  does not remove that cap.
- Step advances one Editor frame; Unity determines the FixedUpdate calls within it.
- Keep the host awake and Game View open. Sleep, locked desktops, minimized Unity,
  and graphics-free batch-mode streaming are not supported.
- iOS, gamepads, sensors, IME/virtual keyboards, public TURN hosting, and multiple
  controllers for one session are outside this preview's scope.
- Browser touch emulation is not a physical Android hardware test.
- Gameplay runs on the host. This does not emulate mobile-device performance,
  native plugins, or Android/iOS build behavior.

## Development and testing

```powershell
.\scripts\setup.ps1
cd service
npm test
npm run test:ui
npm run check:bundle
```

- `npm test` builds the service and tests pairing, authorization, control,
  shutdown, and coordinate mapping.
- `npm run test:ui` uses Playwright and Microsoft Edge to check the web flow and
  responsive layouts against a simulated Editor.
- `npm run check:bundle` checks the committed Git-installable bundles against
  their source files.
- `npm run build` regenerates `Service~` and the bundled Render Streaming runtime.
  Commit those outputs together with changes to their source.

See [Testing](docs/TESTING.md) for live Unity/browser integration tests and
[Verification](docs/VERIFICATION.md) for recorded results and remaining checks.

| Directory | Purpose |
| --- | --- |
| `packages/com.livework.unity` | Git-installable Unity package |
| `service` | Canonical Node service, browser UI, bundling scripts, and tests |
| `android` | Android app that wraps the web client |
| `sample` | Unity demo and integration fixtures |
| `vendor` | Pinned Render Streaming source and documented patches |
| `docs` | Testing and verification notes |

When reporting an issue, include the Unity version, browser, input backend,
reproduction steps, and relevant redacted logs. Do not include pairing codes,
host tokens, or generated host configuration files.

## Third-party licenses

Bundled Render Streaming retains the **Unity Companion License** and its upstream
notices. The QR encoder is licensed under **MIT**. See
[Render Streaming provenance](vendor/UPSTREAM.md),
[Render Streaming license](packages/com.livework.unity/ThirdParty/RenderStreaming/LICENSE.md),
and [QR encoder license](packages/com.livework.unity/Editor/ThirdParty/QrCodeGenerator/LICENSE.txt).

This repository currently does not declare a separate license for LiveWork-authored
code. Third-party licenses apply to their respective components.
