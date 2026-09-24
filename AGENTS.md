# AGENTS.md

Guidance for AI coding agents working in this repository. Humans should start
with [README.md](README.md). This file follows the [agents.md](https://agents.md)
format. A more specific `AGENTS.md` in a subfolder wins over this one for files
in that folder. Direct instructions from the user win over both.

## Project overview

**LiveWork** streams the Unity Editor Game View to a phone or PC browser over
WebRTC, and sends touch, mouse, and keyboard input back to the game. It has four
parts that ship together under one version:

| Part | Path | Stack |
| --- | --- | --- |
| Unity package | `packages/com.livework.unity` | C#, Unity 6 Editor, Render Streaming, WebRTC, Input System |
| Service and web client | `service` | Node.js 22+ (ESM), `ws`, plain browser JavaScript, esbuild, Playwright |
| Android app | `android` | Kotlin, a single-activity WebView app, Gradle Kotlin DSL, JDK 17 |
| Sample project | `sample` | Unity 6000.3.11f1 demo and integration test fixtures |

Other folders:

- `vendor/com.unity.renderstreaming` holds the pinned Unity Render Streaming
  source with local patches. See [vendor/UPSTREAM.md](vendor/UPSTREAM.md).
- `docs` holds the protocol ([docs/PROTOCOL.md](docs/PROTOCOL.md)), test notes
  ([docs/TESTING.md](docs/TESTING.md)), verification records, and brand files.
- `scripts/setup.ps1` installs and builds the service.
- `.upstream/`, `.artifacts/`, and `compat-sample/` are local and ignored by Git.
  Do not commit them and do not treat them as sources.

Supported host: Windows only. Supported Editors: **6000.3.11f1** and
**6000.2.7f2**. The package declares `"unity": "6000.2"`.

## Setup

```powershell
.\scripts\setup.ps1          # npm ci + npm run build in service
```

Requirements: Node.js 22+ with npm, Git, and Microsoft Edge (for UI tests).
Android builds need the Android SDK (platform 36) and JDK 17+. Live Unity tests
need a Unity Editor listed above and a working GPU.

## Build and test commands

Run these from `service`:

```powershell
npm ci                 # install exact dependencies from package-lock.json
npm run build          # bundle signaling, then regenerate Service~ and ThirdParty/RenderStreaming
npm test               # build, then run node --test test/*.test.mjs (no Unity needed)
npm run test:ui        # Playwright UI tests with a simulated Editor (needs Edge)
npm run check:bundle   # fail if the generated package files are stale
npm run brand          # regenerate all logo and icon files
```

Run these from `android`:

```powershell
.\gradlew.bat assembleDebug      # debug APK
.\gradlew.bat assembleRelease    # release APK; signed only when keystore values exist
```

Live Unity integration tests (`test/workflow.mjs`, `test/recovery.mjs`, and the
smoke tests) need a running sample Editor. Follow
[docs/TESTING.md](docs/TESTING.md) exactly. They are not part of CI.

CI (`.github/workflows/ci.yml`) runs `npm ci`, `npm test`, `npm run check:bundle`,
and `npm run test:ui` on Windows, and `./gradlew assembleDebug` on Ubuntu.
A change is not done until these pass locally for the parts you touched.

## Source of truth and generated files

Several committed folders are **generated**. Never edit them by hand. Edit the
source, then run `npm run build` in `service`, and commit the source and the
output together.

| Generated output | Source | Generator |
| --- | --- | --- |
| `packages/com.livework.unity/Service~/**` | `service/server.mjs`, `service/public/**`, `service/package*.json`, `service/upstream/**` | `service/scripts/bundle-service.mjs` |
| `packages/com.livework.unity/ThirdParty/RenderStreaming/**` | `vendor/com.unity.renderstreaming/Runtime/**` | `service/scripts/bundle-renderstreaming.mjs` |
| `service/generated/signaling.cjs` (ignored) | `service/upstream/*.ts` | esbuild in `npm run build` |
| `android/app/src/main/res/**/ic_launcher_*.xml`, `logo.xml`, `docs/brand/**` | brand script | `service/scripts/export-brand.mjs` (`npm run brand`) |

Notes:

- `Service~/bundle.sha256` is a content hash. The Editor uses it to copy the
  service into `Library/LiveWork/service-<hash>`. Any change to the service must
  update the bundle, or users keep running old code.
- The Render Streaming bundle rewrites asset paths and GUIDs so they are stable
  and unique to LiveWork. Do not change GUIDs in `.meta` files by hand.
- Opening the sample in Unity can re-serialize files under
  `ThirdParty/RenderStreaming` (for example `RenderStreamingSettings.asset`).
  Such changes are noise. Restore them with `git restore` unless you meant to
  change the vendor source; `npm run check:bundle` catches them.
- The Android app version is read from `packages/com.livework.unity/package.json`.
  Do not set a version in Gradle.

## Vendored upstream code

- `vendor/com.unity.renderstreaming`, `service/upstream`, and
  `service/public/upstream` are third-party code under their own licenses.
- Keep upstream changes as small as possible. Every patch must be listed in
  [vendor/UPSTREAM.md](vendor/UPSTREAM.md) with the reason and the scope.
- `service/upstream` and `service/public/upstream` must stay unmodified. Wrap
  them from LiveWork code instead.
- `Editor/ThirdParty/QrCodeGenerator` is third-party. Keep its license and notice.
- When you add a dependency or third-party file, update
  `packages/com.livework.unity/Third Party Notices.md`.

## Code style

General:

- Write code, comments, logs, and user-facing text in simple English.
- Match the style of the file you edit. The code is compact: short helpers,
  early returns, and few comments. Add a comment only to explain *why*.
- Keep changes focused. Do not reformat unrelated code or rename public APIs.
- Do not add a dependency without a clear need. Prefer the Node, Unity, or
  Android standard library.

C# (Unity package):

- Namespaces: `LiveWork.Editor` for `Editor/`, `LiveWork` for `Runtime/`.
  Keep the assembly split: `LiveWork.Editor` (Editor only) and
  `LiveWork.Runtime`. Do not reference `UnityEditor` from runtime code.
- Every new asset or script needs its `.meta` file committed. Let Unity create
  it; never copy a `.meta` file from another asset (duplicate GUIDs).
- Survive domain reloads. Keep cross-reload state in `SessionState` (see
  `LiveWorkHost` and `GameViewBridge`), and do not leak callbacks, sockets, or
  processes across a reload.
- Do not change the user's project settings, input settings, scenes, or scripts.
  Restore any Editor setting you change (Game View size, run in background) when
  the session ends.
- Never block the Editor main thread on network or process I/O.

JavaScript (service and web client):

- ES modules only (`"type": "module"`), Node 22 APIs, no TypeScript in LiveWork
  code, no framework and no build step for `service/public`.
- Validate every message from the network. Keep the size limits and the
  `v: 1` protocol version. Compare secrets with `timingSafeEqual`.
- Protocol changes must update [docs/PROTOCOL.md](docs/PROTOCOL.md), the server,
  the web client, and the Editor host in the same change.

Kotlin (Android):

- Keep the app a thin WebView shell. Game logic and UI belong in the web client.
- `minSdk` is 26. Plain HTTP is allowed only through
  `network_security_config.xml` for the private network use case.

## Testing rules

- Add or update a test for every behavior change. Service logic goes in
  `service/test/*.test.mjs` (Node test runner, real local WebSockets). Web UI
  behavior goes in `service/test/ui.mjs`.
- Tests must use port `0` or a free port, and must clean up servers and sockets.
- Live Unity tests launch the isolated `sample` Editor, never a user's project.
  `recovery.mjs` may break only `sample/Assets/ReloadFixture.cs` and must restore
  it in `finally`.
- Write test output, logs, and screenshots only under `.artifacts/`.
- Report results honestly. If you could not run a test (no Unity, no GPU, no
  device), say so. Browser emulation is not a physical Android test.

## Security

LiveWork gives remote control of a developer's Editor. Treat these as hard rules:

- The service accepts only loopback and the networks of the connection mode
  chosen in the Unity window: Tailscale (`100.64.0.0/10`, `fd7a:115c:a1e0::/48`),
  the host's LAN subnet, or the host's ZeroTier subnet. Unity passes them in
  `LIVEWORK_TRUST`. Do not widen this, add public STUN/TURN servers, or bind in
  a way that exposes the service to the internet.
- Pairing is required before any control, signaling, or video. The Editor socket
  is loopback-only and needs the host token. Keep one controller per session.
- Never commit or log secrets: `Library/LiveWork/host.json`, host tokens,
  pairing codes, session cookies, `keystore.properties`, `*.jks`, or
  `local.properties`. Remove codes and tokens from logs you paste into issues.
- Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## Git, commits, and pull requests

- Branches follow Git Flow: `main` holds released code and `develop` holds
  integrated work. Start `feature/<name>` from `develop` and merge it back.
  Start `release/<version>` from `develop` and `hotfix/<version>` from `main`;
  merge both into `main` and `develop`, and tag the release on `main`.
- Use [Conventional Commits](https://www.conventionalcommits.org/):
  `<type>(<optional scope>): <description>`. Allowed types: `feat`, `fix`,
  `refactor`, `perf`, `style`, `test`, `docs`, `build`, `ops`, `chore`.
  Useful scopes: `editor`, `web`, `service`, `android`, `release`.
  Use the imperative mood, a lowercase start, and no final period.
  Mark breaking changes with `!` and a `BREAKING CHANGE:` footer.
- One logical change per commit. Commit generated bundles with their source.
- Before you commit: run the relevant commands above, `npm run check:bundle`,
  and `git diff --check`, then review the full diff.
- Update [CHANGELOG.md](packages/com.livework.unity/CHANGELOG.md) under an
  `Unreleased` section for user-visible changes
  ([Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format).
- Update `README.md` **and** `README.vi.md` together when user-facing behavior,
  requirements, or install steps change.
- Do not push, tag, or create releases unless the user asks.

## Releases

Versioning follows [SemVer](https://semver.org). The single version lives in
`packages/com.livework.unity/package.json`; `service/package.json` must match it.

1. Bump both versions and move the changelog entries to `## [x.y.z] - YYYY-MM-DD`
   with a compare link at the bottom.
2. Run `npm run build` so `Service~/package.json` and the bundle hash update.
3. Update the version in the README install URLs (`#vX.Y.Z`).
4. Commit as `chore(release): prepare x.y.z`, then tag `vX.Y.Z`.

Pushing the tag runs `.github/workflows/release.yml`. It checks that the tag
matches the package version, builds the signed APK, and creates the GitHub
release from the changelog. The release must stay non-prerelease so
`releases/latest/download/LiveWork.apk` keeps working.

## Boundaries

Always:

- Read the relevant docs (`docs/PROTOCOL.md`, `docs/TESTING.md`,
  `vendor/UPSTREAM.md`) before changing that area.
- Keep the web client usable down to 320 px wide and with touch input.
- Keep Windows paths and PowerShell commands working; CI also runs Gradle on Linux.

Ask first:

- Adding a dependency, a Unity package, or a new supported Unity version.
- Changing the protocol version, the network allowlist, or the pairing flow.
- Patching vendored Render Streaming code.
- Changing CI, release workflows, signing, or the Android package name.

Never:

- Edit generated files by hand or commit a stale bundle.
- Commit secrets, `Library/`, `Temp/`, `Logs/`, `UserSettings/`, `.artifacts/`,
  `node_modules/`, or build outputs.
- Run live tests against a user's real game project or modify its assets.
- Skip Git hooks, force-push `main`, or rewrite published tags.
