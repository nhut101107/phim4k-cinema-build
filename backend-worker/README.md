# 4K Cinema licensing and media gateway

This Worker is the server-side authorization boundary. Production clients exchange
a license/admin key once for a short-lived access token and a rotating refresh
token. Every authenticated request also carries a P-256 device proof and a
single-use nonce. Raw keys are not accepted as ongoing production authentication.

The repository contains no secret value. Configure these Worker secrets after
deployment:

- `ADMIN_LICENSE_KEY`: existing master license key, or a newly generated private key.
- `ADMIN_TELEGRAM_ID`: Telegram ID allowed to activate an administrator session.
- `ADMIN_KEY_PEPPER`: at least 32 random bytes used as the HMAC key for an
  administrator key rotated from the panel.
- `MEDIA_TICKET_SECRET`: at least 32 random bytes, used only by the Worker to seal
  opaque image/playback capabilities.
- `VPS_RELAY_SECRET`: at least 32 random bytes and identical to the private relay
  configuration; never place it in a client build.
- `VPS_RELAY_ORIGIN`: public HTTPS origin of the authenticated relay.
- `MOVIE_CATALOG_ORIGIN`: licensed upstream catalogue HTTPS origin.
- `MOVIE_IMAGE_HOSTS`: comma-separated allowlist of image hosts returned by that
  catalogue.
- `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ADMIN_CHAT_ID`: optional device-approval
  notification integration.
- `JELLYFIN_BASE_URL`: optional HTTPS origin of a self-hosted Jellyfin server. The
  admin content panel probes only `/System/Info/Public` and reports readiness; no
  Jellyfin credential is returned to the app. Use this only with media you own or
  are licensed to distribute.

Deployment sequence:

1. Log in with `npx wrangler login`.
2. Create the database: `npx wrangler d1 create phim4k-license`.
3. Replace `REPLACE_WITH_D1_DATABASE_ID` in `wrangler.toml` with the reported ID.
4. For a new database apply `schema.sql`. For an existing production database,
   back it up and apply `migrations/0002_security_sessions.sql` during an approved
   maintenance window.
5. Deploy: `npx wrangler deploy`.
6. Set each required secret with `npx wrangler secret put ...`.

Use the resulting `https://*.workers.dev` origin as the IPA build input.

Do not enable `ALLOW_LEGACY_TEST_AUTH` in production. It exists only so older unit
fixtures can exercise legacy decisions while the migration remains reviewable.

Published downloads must use HTTPS and include their exact SHA-256. Android also
checks file size, package ID, version monotonicity and the installed signing
certificate before opening the package installer.
