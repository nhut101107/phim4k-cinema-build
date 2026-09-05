# Phim4K licensing backend

This Worker replaces the local key-management server with a persistent HTTPS API.
It contains no administrative credential. Configure the following Worker secrets
after deployment:

- `ADMIN_LICENSE_KEY`: existing master license key, or a newly generated private key.
- `ADMIN_TELEGRAM_ID`: optional Telegram ID allowed to use the administrative panel.
- `JELLYFIN_BASE_URL`: optional HTTPS origin of a self-hosted Jellyfin server. The
  admin content panel probes only `/System/Info/Public` and reports readiness; no
  Jellyfin credential is returned to the app. Use this only with media you own or
  are licensed to distribute.

Deployment sequence:

1. Log in with `npx wrangler login`.
2. Create the database: `npx wrangler d1 create phim4k-license`.
3. Replace `REPLACE_WITH_D1_DATABASE_ID` in `wrangler.toml` with the reported ID.
4. Apply the schema: `npx wrangler d1 execute phim4k-license --remote --file=schema.sql`.
5. Deploy: `npx wrangler deploy`.
6. Set the two secrets with `npx wrangler secret put ...`.

Use the resulting `https://*.workers.dev` origin as the IPA build input.
