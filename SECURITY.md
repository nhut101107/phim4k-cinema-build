# 4K Cinema security model

## Trust boundary

All entitlement, administrator, maintenance, ban, device and playback decisions
are made by the Cloudflare Worker and D1. The iOS, Android, Android TV and Windows
clients are treated as untrusted. Client integrity checks are defense-in-depth;
they are never sufficient to grant premium or administrator access.

Clients receive only the public Worker origin and short-lived opaque capabilities.
Licensed provider credentials and upstream media URLs belong in Worker/VPS secrets
and responses, logs, analytics and release artifacts must not expose them.

## Sessions

- A license/admin key is submitted only to the TLS-protected activation or
  pre-activation device-approval endpoints; it is never ongoing request auth.
- Access tokens expire after 15 minutes; refresh tokens expire after 30 days.
- Refresh tokens rotate and reuse revokes the complete session family.
- A partial unique database index allows only one active viewer session per
  license; concurrent activations are resolved server-side.
- Each request is bound to a non-extractable P-256 device key, timestamp and
  server-consumed nonce.
- iOS stores the session in Keychain (`ThisDeviceOnly`), Android uses an AES-GCM
  key in Android Keystore, and Windows uses Electron `safeStorage`.
- Browser fallback uses IndexedDB and therefore has lower assurance than a native
  secure store.

## Playback

The Worker resolves movie/server/episode references, verifies the current server
session, and issues encrypted capabilities scoped to a session and expiry. The
VPS relay accepts only HMAC-authenticated requests from the Worker, validates and
pins public DNS destinations, limits redirects/body sizes/concurrency and binds to
loopback behind its tunnel. The retired Express URL proxy always returns HTTP 410.

Signed URLs reduce casual sharing and scraping. They do not prevent an authorized
viewer from recording output. Strong offline/content protection requires licensed
FairPlay, Widevine and PlayReady integration from the content provider.

## Release and rollout

1. Back up D1 and apply `backend-worker/migrations/0002_security_sessions.sql`.
2. Configure secrets listed in `backend-worker/README.md` and deploy the Worker and
   relay together during an approved maintenance window.
3. Publish signed client builds, calculate SHA-256 and byte size, then enter those
   values in the administrator Downloads panel.
4. Keep force-update disabled until the new downloads have been verified on real
   iOS, Android phone, Android TV and Windows devices.
5. Revoke/rotate any provider or administrator credential that has previously
   shipped in a client. Rotation is an operator action and is never automatic.

Never put signing certificates, provisioning profiles, API credentials, relay
secrets, source maps or symbol files in a public release artifact.
