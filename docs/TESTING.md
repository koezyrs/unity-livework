# Tests

## Service and coordinate mapping

Run `npm test` from `service`. Uses Node's test runner and real local WebSockets;
no Unity installation is needed. Covers pairing failures, Unicode input, origin
checks, exclusive control, validation, forwarding/results, disconnect reset and
portrait/landscape letterboxing, plus host-authorized shutdown and port reuse,
scene list and log forwarding, log replay and limits, host token removal from
logs, and scene command validation.

Run `npm run test:ui` for browser checks with a simulated Editor. These cover code
and QR pairing, exclusive control, transport states, custom resolution validation,
the scene picker, the console (filters, search, copy, safe text, error badge),
mute, fullscreen and layouts down to 320 px. Microsoft Edge is required.
Run `npm run check:bundle` before committing to verify that the Git package's web
service and patched Render Streaming runtime match their canonical sources.

## Unity and browser integration

Requires Unity **6000.3.11f1** or **6000.2.7f2**, Windows, Node 22+, Microsoft Edge, a working GPU,
and the dependencies installed by `scripts/setup.ps1`. These tests launch an
isolated sample Editor, never the user's game project. Do not manually play in
the sample or connect a second browser while tests hold the controller lease.

Start the sample from PowerShell in the repo root:

```powershell
New-Item -ItemType Directory -Force .artifacts | Out-Null
Start-Process 'C:\Program Files\Unity\Hub\Editor\6000.3.11f1\Editor\Unity.exe' `
  -ArgumentList '-projectPath "E:\PERSONAL_WORK\unity-livework\sample" -executeMethod LiveWorkSample.Launch -liveworkTest -logFile "E:\PERSONAL_WORK\unity-livework\.artifacts\sample-session.log"' -WindowStyle Hidden
```

Adjust the two absolute repo paths for your checkout. Wait for the Editor to
finish loading and create `sample/Library/LiveWork/host.json`, then run:

```powershell
cd service
node test/workflow.mjs
node test/recovery.mjs
```

`workflow.mjs` tests media, actual game keyboard/mouse/UI, multi-touch via Chrome
DevTools Protocol, pause/exactly-one-frame, resolution change, browser reload,
Stop/Play and clearing a held key after disconnect. It uses Both input mode.

`recovery.mjs` tests paused reconnect/resizing, scene changes, hot reload, and
compile failure/fix. It intentionally introduces a compile error **only** in
`sample/Assets/ReloadFixture.cs` and restores valid code in `finally`.

Diagnostics and screenshots are written under `.artifacts/`. Test-only file
commands (`refresh-sample`, `reload-scene`, `start-server`, `end-server`, `close-sample`) are enabled solely by
the `-liveworkTest` argument; they are not part of the distributable package.
Create `.artifacts/close-sample` to gracefully stop the sample test Editor.

For a copy of the sample named `compat-sample`, set
`$env:LIVEWORK_TEST_PROJECT = 'compat-sample'` before running `recovery.mjs` so
its compile fixture targets the correct project. Keep only one sample Editor
enabled on the service. `browser-smoke.mjs` also measures received audio energy;
set `LIVEWORK_HOST_CONFIG` to the absolute `Library/LiveWork/host.json` path when
using another project (the default is the sample's configuration);
set `LIVEWORK_TEST_URL` to test the host's Tailscale HTTP address. For an installed
game already in Play Mode, `installed-smoke.mjs` checks media and captures a
mobile-layout screenshot without sending gameplay input or changing Play state.

## One-URL Git installation

Use a clean project and add only the LiveWork Git dependency shown in the README.
Check that no standalone `com.unity.renderstreaming` package is registered and
that Unity resolves WebRTC/Input System/uGUI automatically. On first Start,
verify npm preparation occurs under `Library/LiveWork`, not PackageCache.
Check Start → End → Start, a released port after End, and unchanged Play Mode.

## Original Legacy compatibility probe

`LiveWorkProbe.Inspect` runs in Unity batchmode and writes API capability metadata.
`LiveWorkProbe.RunLegacy` runs in a graphical sample Editor and exits after 90
frames, writing `.artifacts/legacy-result.json`. It deliberately checks legacy
keyboard/mouse separately from touch-to-mouse emulation. Legacy keyboard/mouse
results are expected to be false; virtual Input System keyboard and multi-touch
are expected to be true. Run only in the sample: it creates/replaces its probe scene.

## Physical-device acceptance still required

Chrome emulation is not an Android hardware test. Use an Android phone on a
different internet connection, with both devices on Tailscale. Check simultaneous
touches, dragging UI, audio after tapping Sound, rotation, fullscreen, packet loss,
Wi-Fi/mobile switching and host firewall behavior. Record actual FPS/bitrate/RTT;
RTT is not end-to-end input-to-display latency.

