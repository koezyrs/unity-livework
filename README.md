<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/banner-dark.png">
    <img alt="LiveWork" src="docs/brand/banner-light.png" width="720">
  </picture>
</p>

<p align="center">
  <a href="https://github.com/koezyrs/unity-livework/releases/latest"><img alt="Release" src="https://img.shields.io/github/v/release/koezyrs/unity-livework?include_prereleases&label=release&color=ff4545"></a>
  <img alt="Unity 6" src="https://img.shields.io/badge/Unity-6000.2%20%7C%206000.3-222?logo=unity">
  <img alt="Windows host" src="https://img.shields.io/badge/host-Windows-222?logo=windows">
  <a href="https://github.com/koezyrs/unity-livework/releases/latest/download/LiveWork.apk"><img alt="Android app" src="https://img.shields.io/badge/Android-download%20APK-222?logo=android"></a>
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-222"></a>
</p>

<p align="center">
  <b>English</b> · <a href="README.vi.md">Tiếng Việt</a>
</p>

**LiveWork** streams the Unity Editor Game View to your phone or PC browser, and
you play it live. Touch, mouse, and keyboard input go straight back to your game.
No build, no install on the device, no changes to your game scripts.

Change a script, press Play, and try it on a real phone in seconds.

<p align="center">
  <img alt="Pairing screen" src="docs/images/web-pairing.png" width="260">
  &nbsp;&nbsp;
  <img alt="Settings screen" src="docs/images/web-settings.png" width="260">
</p>

## Features

- **Play the Editor from your phone.** Video and audio over WebRTC. Multi-touch,
  mouse, and keyboard input go to the game.
- **Android app.** Scan the QR code and play in full screen. The app keeps the
  screen on and stays clear of the camera cutout. A browser works too.
- **Unity-style controls.** Play/Stop, Pause/Resume, and Step from the phone.
- **Real Game View resolution.** Pick a preset or type a custom size.
- **Stream quality presets.** Smooth for mobile data, Balanced, or Sharp.
- **Low latency.** H.264 hardware encoding, no video buffer delay, and input
  sent at most once per frame.
- **Quick pairing.** Scan the QR code, or type the six-digit code.
- **Session recovery.** Reconnects after a page reload, Play/Stop, scene changes,
  and script reloads.
- **One Git URL install.** The patched Render Streaming runtime and the web
  service are included.

## Requirements

| Component | Supported |
| --- | --- |
| Host OS | Windows |
| Unity Editor | **6000.3.11f1** or **6000.2.7f2** |
| Node.js | **22 or newer**, with npm on PATH |
| Git | Installed and available to Unity Package Manager |
| Network | [Tailscale](https://tailscale.com) on both devices, or localhost on the host |
| Phone | Android 8.0 or newer (app or Chrome), or Chrome/Edge on desktop |
| Audio | An active AudioListener in the scene |
| Keyboard/mouse | Active Input Handling set to **Input System** or **Both** |

Install Node.js, Git, and Tailscale before you start LiveWork. Restart Unity
after you install Node.js so Unity sees the new PATH.

## Quick start

### 1. Install the Unity package

1. Open **Window → Package Manager**.
2. Select **+ → Install package from git URL**.
3. Paste this URL:

   ```text
   https://github.com/koezyrs/unity-livework.git?path=/packages/com.livework.unity#v0.2.0
   ```

4. Wait for Unity to install the dependencies and compile.

Remove `#v0.2.0` to always get the latest code from `main`.

### 2. Install the Android app (optional)

1. On the phone, open the
   [latest release](https://github.com/koezyrs/unity-livework/releases/latest)
   and download **LiveWork.apk**.
2. Open the file. Allow your browser to install unknown apps when Android asks.
3. Tap **Install**.

No USB cable or developer mode is needed. You can also use Chrome instead of the app.

### 3. Connect

1. Open your scene, then open **Window → LiveWork** and click **Start server**.
   The first start downloads the service dependencies with npm.
2. Set **Connection Mode** to **Android** for the app, or **Web** for a browser.
3. Scan the QR code with the phone.
4. Press **Play** in the toolbar, then touch the game.

For a phone, both devices must be on the same Tailscale network. A `127.0.0.1`
address works only on the host computer.

## Usage

### Unity LiveWork window

| Control | Action |
| --- | --- |
| Address · Copy | Copy the address |
| Address · Open | Open the address in the host's browser |
| Pairing code | The six-digit code to type on the device |
| Connection Mode | **Web**: the QR code opens the browser. **Android**: it opens the LiveWork app |
| Start server / End server | Start or stop the LiveWork service for this project |

Each new server session creates a new pairing code. Ending a session restores
the previous Game View and run-in-background settings. Play Mode is not changed.

### Toolbar on the device

| Control | Action |
| --- | --- |
| Play / Stop | Enter or exit Play Mode |
| Pause / Resume | Pause or continue the game |
| Step | Advance one frame while paused |
| Sound | Turn audio on or off (starts muted) |
| Fullscreen | Show only the game |
| ☰ Settings | Game resolution and stream quality |
| Right-click the game | Lock the pointer (desktop browsers) |

**Game resolution** changes the real Game View, not only the picture on the
device. Each side must be even and between 240 and 1920, with at most 2,073,600
pixels in total.

**Stream quality:**

| Preset | Max size | Max bitrate | Best for |
| --- | --- | --- | --- |
| Smooth | 960 px | 2.5 Mbps | Mobile data |
| Balanced (default) | 1280 px | 4 Mbps | Most networks |
| Sharp | 1280 px | 8 Mbps | Fast Wi-Fi |

### Input support

| Active Input Handling | Supported input |
| --- | --- |
| Input System | Multi-touch, mouse, scroll, keyboard, pointer lock |
| Input Manager (Old) | Touch only |
| Both | Input System input and legacy touch |

LiveWork does not change your input settings, action maps, input modules, or
game scripts.

## Performance tips

- **Check the Tailscale path.** Run `tailscale ping <phone-name>` on the host.
  `via DERP` means traffic goes through a relay and adds delay. A `direct`
  connection is much faster. On strict mobile networks, allow UDP port 41641 in
  the host firewall or try another network.
- **Use Smooth on mobile data.** A lower bitrate avoids packet loss, which shows
  up as stutter and late touches.
- **Stop background throttling.** In **Edit → Preferences → General**, set
  **Interaction Mode** to **No Throttling**.
- **Use an NVIDIA GPU if you can.** Unity encodes H.264 on NVIDIA GPUs. Other
  hosts use a slower CPU encoder.

## Network and security

- Each project runs its own service on a free port. Copy the address from the
  LiveWork window.
- The service accepts only localhost and Tailscale addresses, and it requires
  pairing before any control or video.
- Video and input go directly between the two devices. No public STUN or TURN
  server is used.
- The Android app and the web client use plain HTTP inside your private
  Tailscale network. Do not expose the service to the public internet.
- `Library/LiveWork/host.json` contains local credentials. Do not commit it.

## Troubleshooting

| Problem | What to check |
| --- | --- |
| Start server fails | Install Node.js 22+ with npm, restart Unity, and read the error in the window |
| First start fails | Check the npm connection and proxy settings, then try again |
| The phone cannot open the address | Connect both devices to Tailscale. Do not use `127.0.0.1` on the phone |
| "Another browser may be controlling Unity" | Close the other tab or app, then connect again |
| The pairing code is rejected | Use the current code. Restarting the server changes it |
| Duplicate Render Streaming assembly | Remove the separate `com.unity.renderstreaming` package |
| The game ignores keyboard or mouse | Use Input System or Both, and check your bindings |
| No sound | Check the AudioListener, then tap the sound button |
| Play does not start | Fix the compile errors in the Unity Console |
| Video stutters or lags | See [Performance tips](#performance-tips) |
| The app does not install over an older version | Uninstall the older app first. It was signed with a different key |

## Limitations

- This is a preview. Only the Unity versions listed above are supported.
- The stream runs at up to 30 FPS.
- The game runs on the host. LiveWork does not test device performance, native
  plugins, or Android build behavior.
- Keep the host awake and Unity visible. Sleep, a locked screen, and a minimized
  Editor stop the stream.
- Not supported yet: macOS and Linux hosts, iOS app, gamepads, sensors, on-screen
  keyboard input, and more than one controller per session.

## Development

```powershell
.\scripts\setup.ps1
cd service
npm test              # service tests
npm run test:ui       # web UI tests with Playwright and Microsoft Edge
npm run check:bundle  # checks the committed package bundles
npm run build         # regenerates Service~ and the bundled runtime
npm run brand         # regenerates all logo files
```

To build the Android app, see [android/README.md](android/README.md).
For live Unity tests, see [docs/TESTING.md](docs/TESTING.md).

| Folder | Purpose |
| --- | --- |
| `packages/com.livework.unity` | The Unity package |
| `service` | Node service, web client, bundling scripts, and tests |
| `android` | Android app |
| `sample` | Unity demo project and test fixtures |
| `vendor` | Pinned Render Streaming source and patches |
| `docs` | Protocol, testing notes, and brand files |

When you report a bug, include the Unity version, the device and browser or app
version, the input backend, the steps to reproduce, and logs. Remove pairing
codes and tokens from the logs.

## License

LiveWork is released under the [MIT License](LICENSE).

The bundled Unity Render Streaming code uses the
[Unity Companion License](packages/com.livework.unity/ThirdParty/RenderStreaming/LICENSE.md).
See [Third Party Notices](packages/com.livework.unity/Third%20Party%20Notices.md)
for all third-party components.

Unity is a trademark of Unity Technologies. LiveWork is not affiliated with or
endorsed by Unity Technologies.
