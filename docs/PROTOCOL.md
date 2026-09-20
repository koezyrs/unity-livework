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

Commands: `Play`, `Stop`, `Pause`, `Resume`, `Step`, `SetResolution`.
The Editor replies only after observing completion, or replies with an error.
Requests are not queued for an offline Editor or replayed on reconnect. A pending
transition may survive domain reload via SessionState; this resumes observation,
not execution. The service times out after 20 seconds.

State contains `state`, `message`, `width`, `height`, `revision`, `frame`,
`inputMode`, `unity`, `streaming`, `isPlaying`, `isPaused`. `state` is one of
`offline`, `stopped`, `playing`, `paused`, `reloading`, `error`. Connection setup
is displayed as `connecting` by the client. `revision` changes on every recreated
stream; input from an old revision is discarded.

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
