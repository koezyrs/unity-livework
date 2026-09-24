# LiveWork protocol v1

Control and signaling are separate from the WebRTC session. All control messages
have `v: 1`. JSON is capped at 128 KiB; data channel input is capped at 8 KiB.

## Authentication and transports

- `POST /api/pair`, JSON `{ "code": "123456" }`: establishes an HttpOnly,
  SameSite=Strict browser cookie. Ten attempts per source IP per minute.
- `GET /api/session`: `{ "authenticated": true|false }`, no secret data.
- `GET /api/health`: service name and protocol version.
- `/control`: authenticated browser WebSocket, single controller lease.
- `/editor?token=...`: loopback-only Editor WebSocket with a random host secret.
- `/signal/browser`, `/signal/editor?token=...`: authenticated upstream Render
  Streaming signaling. Offers and answers are bidirectional for renegotiation.
- WebRTC data channel `livework-input`: ordered/reliable gameplay input. Neither
  gameplay input nor editor commands are accepted through the public static pages.

## Editor commands and state

```json
{"v":1,"type":"command","id":"unique-request-id","command":"SetResolution","width":720,"height":1280}
{"v":1,"type":"result","id":"unique-request-id","ok":true,"message":"Completed"}
```

Commands: `Play`, `Stop`, `Pause`, `Resume`, `Step`, `SetResolution`, `SetStreamQuality`,
`SelectScene`. `SelectScene` and `Play` take `scene`: a `.unity` asset path (at
most 512 characters) from the latest scene list. `SelectScene` is required to
have it and works only in Edit Mode: it sets the Play Mode start scene, without
opening the scene, so the next Play runs it. For `Play`, `scene` is optional and
works only in Play Mode: the Editor stops and plays again in that scene. The
service waits 60 seconds for this command instead of 20. The Editor restores the
user's own start scene when the LiveWork session ends.
`SetStreamQuality` takes `quality`: `smooth` (960 px longest edge, 2.5 Mbps),
`balanced` (default, 1280 px, 4 Mbps) or `sharp` (1280 px, 8 Mbps). All run at
30 FPS. The Editor recreates the stream with the new settings, so `revision` changes.
The Editor replies only after observing completion, or replies with an error.
Requests are not queued for an offline Editor or replayed on reconnect. A pending
transition may survive domain reload via SessionState; this resumes observation,
not execution. The service times out after 20 seconds.

State contains `state`, `message`, `width`, `height`, `revision`, `frame`,
`inputMode`, `quality`, `scene`, `startScene`, `unity`, `streaming`, `isPlaying`,
`isPaused`. `scene` is the path of the active scene in Play Mode, or empty.
`startScene` is the scene that Play runs (or ran): the Play Mode start scene, or
else the active Editor scene. It is empty for an unsaved scene. `state` is one of
`offline`, `stopped`, `playing`, `paused`, `reloading`, `error`. Connection setup
is displayed as `connecting` by the client. `revision` changes on every recreated
stream; input from an old revision is discarded.

## Scenes and logs

The Editor sends these messages; the service checks and forwards them to the
controller. When a controller connects, the service sends `state`, the latest
`scenes`, and the stored logs with `replay: true`.

```json
{"v":1,"type":"scenes","truncated":false,"scenes":[{"path":"Assets/Main.unity","name":"Main","inBuild":true}]}
{"v":1,"type":"logs","entries":[{"seq":1,"level":"error","message":"Boom","stack":"Game.Update ()","time":1760000000000}]}
```

- `scenes` lists up to 2000 scenes from `Assets` and `Packages`. `inBuild` marks
  enabled Build Settings scenes. The Editor sends the list after `hello` and when
  the project or Build Settings change.
- `level` is `info`, `warning`, or `error` (errors, exceptions, and asserts).
  The service numbers entries with `seq`, cuts `message` to 4000 and `stack` to
  8000 characters, removes the host token, and keeps the last 500 entries.
- The Editor sends at most 100 entries every 250 ms and 200 per second. Extra
  entries are dropped and reported by one warning entry.

## Gameplay input

Each message includes `v: 1`, current `revision`, and `type`:

- `key`: DOM `code` and boolean `down`; repeats are suppressed.
- `mouse`: normalized `x/y` (top-left origin), DOM `buttons` bitmask, normalized
  relative `dx/dy`, `locked`, `scroll` in browser pixel units.
- `touch`: stable `id` 1–10, normalized `x/y`, and `phase` (`began`, `moved`,
  `ended`, `canceled`). Each finger's transitions preserve frame order for Legacy.
- `reset`: release this session's input devices and cancel touches.
- `heartbeat`: keeps held input valid. No input heartbeat for two seconds releases
  held state. Control/signaling disconnect, blur, hide, resolution changes and
  Stop also reset input.

Backend chooses New, Legacy or Both from the project's existing Active Input
Handling. Legacy receives only touch; it does not receive virtual keyboard/mouse
or synthetic legacy axes. The first InputUser, if present, is paired with the
remote devices; multi-player device ownership is out of scope.
