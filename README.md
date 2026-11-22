# download-hub

> Download hub runs directly on **Node.js** behind an Nginx reverse proxy, stores files on **Cloudflare R2**, protects public downloads with **Cloudflare Turnstile**, and protects the admin with **Cloudflare Access (T43iD)**.

## Canonical Architecture (R2 Primary)

```text
Internet
  -> CloudPanel Nginx reverse proxy (HTTPS)
  -> Node.js app via PM2 (127.0.0.1:3000)
  -> Cloudflare R2 (object storage)
```

### Security model
- **Public download flow**: Turnstile → server verify → issue short-lived HMAC download token → stream/download from R2.
- **Admin flow**: Cloudflare Access app `download-hub-admin` (`/admin`, `/admin/*`, `/api/admin/*`, policy `t43-admins`, IdP T43iD). The app verifies the Access JWT on every admin request (`src/lib/t43id-access.js`, AUD in `T43ID_ACCESS_AUD` from t43vault app `download-hub`, required in production).
- **Admin APIs**: `/api/admin/*` require a valid Access JWT; cross-site mutating requests are rejected.
- **Legacy bearer token**: compatibility only, not the primary production flow.

## Stack
- Node.js 20+
- PM2 (process manager)
- Express 5 + EJS
- Helmet + CSP nonce
- Cloudflare Turnstile (public)
- Cloudflare Access (T43iD) for admin
- Cloudflare R2 via S3-compatible API

## Main features
- Public bilingual VI/EN download catalog
- Detail page per file
- Turnstile-protected public download flow
- Short-lived HMAC token to reduce hotlinking
- Admin sign-in with T43iD (Cloudflare Access)
- Admin R2 panel for listing objects, presigned upload, metadata editing, publish/unpublish workflow
- Health endpoint: `/health`

## Important routes
### Public
- `GET /`
- `GET /download/:slug`
- `POST /api/verify/:slug`
- `GET /files/:slug?token=...`
- `GET /health`

### Admin
- `POST /admin/logout`
- `GET /admin/r2`
- `GET /api/admin/r2/status`
- `GET /api/admin/r2/files`
- `POST /api/admin/r2/sync`
- `POST /api/admin/r2/upload-url`
- `POST /api/admin/r2/upload-confirm`
- `PATCH /api/admin/r2/files/:slug/publish`
- `PATCH /api/admin/r2/files/:slug/metadata`
- `DELETE /api/admin/r2/files/:slug`

## Project structure
```text
src/
  data/files.json
  lib/
  middleware/
  routes/
  server.js
views/
public/
deploy/
  ecosystem.config.cjs
  nginx-download-hub.conf
```

## Production deployment (canonical, since 2026-10-31)
- **Node**: HKG-1, systemd `download-hub.service` + drop-in `download-hub.service.d/10-user.conf` (user `dlhub`,
  hardening), both in `deploy/`. No PM2, no CloudPanel.
- **Code**: `/opt/download-hub/app` (src, views, public + production `node_modules`, built and tested on HQ-01:
  `npm ci`, `npm test`, `npm prune --omit=dev`; deps are pure JS). The previous build is kept in `app.prev`.
- **Data** stays in `/opt/download-hub/{data,src/data,storage}` (absolute paths in the env, `ReadWritePaths`).
- **Env/secrets**: t43vault app `download-hub` (all keys of the old `.env`), fetched by `ExecStartPre` into
  `/run/t43vault/download-hub/env`. Change one: `t43vault set download-hub KEY < value` on HQ-01, then
  `systemctl restart download-hub` on HKG-1.
- **Reverse proxy**: nginx loopback on HKG-1 behind the Cloudflare Tunnel; **Storage**: Cloudflare R2.

Deploy / update (HQ-01, deploys the committed HEAD):
```bash
deploy/deploy.sh            # build + test, swap app, restart; health fails -> app.prev comes back
deploy/deploy.sh rollback   # swap app and app.prev
```
`deploy/ecosystem.config.cjs` is the old PM2 config, kept for reference only.

## Required production env
Minimum required values:

```env
NODE_ENV=production
APP_BASE_URL=https://downloads.example.com
APP_HOSTNAME=downloads.example.com
DOWNLOAD_TOKEN_SECRET=<long-random-secret>

T43ID_TEAM_DOMAIN=t43.cloudflareaccess.com
T43ID_ACCESS_AUD=<access-app-aud-tag>
T43ID_ALLOW_GROUPS=admins

TURNSTILE_ENABLED=true
TURNSTILE_SITE_KEY=...
TURNSTILE_SECRET_KEY=...
TURNSTILE_ACTION=download_gate


R2_ENABLED=true
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=your-r2-bucket-name
```

## CloudPanel reverse proxy
CloudPanel terminates HTTPS and proxies traffic to the local Node.js process on `127.0.0.1:3000`.

Use the nginx sample in:
- `deploy/nginx-download-hub.conf`

## Admin workflow
1. Open `/admin` (Cloudflare Access signs you in with T43iD)
2. Use `/admin/r2`
3. Upload to R2, sync object metadata, review draft records, publish entries

## Local development
```bash
cp .env.example .env
npm install
npm run check
npm run dev
```

## Demo scaffold note
This repository may still include demo/placeholder data in `src/data/files.json` for local/dev purposes. Treat them as scaffold data, not production content.
