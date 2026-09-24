# Security Policy

## Supported versions

Only the latest release of LiveWork gets security fixes.

## Report a problem

Do not open a public issue for a security problem. Report it privately with
[GitHub security advisories](https://github.com/koezyrs/unity-livework/security/advisories/new).

Please include:

- the LiveWork and Unity versions,
- what an attacker can do,
- the steps to reproduce.

You should get a reply within 7 days.

## Scope

LiveWork is built for private networks: localhost, a trusted LAN, Tailscale, or
ZeroTier. The service accepts only localhost and the network of the connection
mode chosen in Unity, and it requires a pairing code. Exposing the service to
the public internet is not supported.
