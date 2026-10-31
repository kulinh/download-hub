# download-hub

> Download hub chạy trực tiếp bằng **Node.js + PM2** sau **CloudPanel Nginx reverse proxy**, lưu file trên **Cloudflare R2**, bảo vệ public download bằng **Cloudflare Turnstile**, và bảo vệ admin bằng **username + password + hCaptcha + session cookie**.

## Canonical Architecture (R2 Primary)

```text
Internet
  -> CloudPanel Nginx reverse proxy (HTTPS)
  -> Node.js app via PM2 (127.0.0.1:3000)
  -> Cloudflare R2 (object storage)
```

### Security model
- **Public download flow**: Turnstile → server verify → issue short-lived HMAC download token → stream/download from R2.
- **Admin flow**: `/admin/login` → username + password + hCaptcha → signed session cookie.
- **Admin APIs**: `/api/admin/r2/*` and related admin ops use session-cookie auth + CSRF protection.
- **Legacy bearer token**: compatibility only, not the primary production flow.

## Stack
- Node.js 20+
- PM2 (process manager)
- Express 5 + EJS
- Helmet + CSP nonce
- Cloudflare Turnstile (public)
- hCaptcha (admin login)
- Cloudflare R2 via S3-compatible API

## Main features
- Public bilingual VI/EN download catalog
- Detail page per file
- Turnstile-protected public download flow
- Short-lived HMAC token to reduce hotlinking
- Admin login with hard auth + hCaptcha
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
- `GET /admin/login`
- `POST /admin/login`
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
  hardening), both in `deploy/` and installed by **t43deploy**. No PM2, no CloudPanel.
- **Code**: t43deploy release `/opt/t43deploy/download-hub/current/app` (src, views, public + production
  `node_modules`, built and tested on HQ-01: `npm ci`, `npm test`, `npm prune --omit=dev`; deps are pure JS).
- **Data** stays in `/opt/download-hub/{data,src/data,storage}` (absolute paths in the env, `ReadWritePaths`).
- **Env/secrets**: t43vault app `download-hub` (all keys of the old `.env`), fetched by `ExecStartPre` into
  `/run/t43vault/download-hub/env`. Change one: `t43vault set download-hub KEY < value` on HQ-01, then
  `systemctl restart download-hub` on HKG-1. The old `/opt/download-hub/.env.pre-vault` (600) is kept until 2026-11-07.
- **Reverse proxy**: nginx loopback on HKG-1 behind the Cloudflare Tunnel; **Storage**: Cloudflare R2.

Deploy / update (HQ-01, worktree must be clean, so use a detached one):
```bash
git -C /opt/download-hub worktree add --detach /var/tmp/t43deploy-download-hub HEAD
t43deploy -C /var/tmp/t43deploy-download-hub          # health: /health ok, / renders, no restarts
git -C /opt/download-hub worktree remove /var/tmp/t43deploy-download-hub
t43deploy status -C /opt/download-hub                 # release per node, is it HEAD
t43deploy rollback -C /opt/download-hub HKG-1         # previous release
```
`deploy/ecosystem.config.cjs` is the old PM2 config, kept for reference only.

## Required production env
Minimum required values:

```env
NODE_ENV=production
APP_BASE_URL=https://downloads.example.com
APP_HOSTNAME=downloads.example.com
DOWNLOAD_TOKEN_SECRET=<long-random-secret>

ADMIN_USERNAME=<admin-user>
ADMIN_PASSWORD=<strong-password>
ADMIN_SESSION_SECRET=<long-random-secret>

TURNSTILE_ENABLED=true
TURNSTILE_SITE_KEY=...
TURNSTILE_SECRET_KEY=...
TURNSTILE_ACTION=download_gate

HCAPTCHA_ENABLED=true
HCAPTCHA_SITE_KEY=...
HCAPTCHA_SECRET_KEY=...
HCAPTCHA_EXPECTED_HOSTNAME=downloads.example.com

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
1. Visit `/admin/login`
2. Complete **hCaptcha**
3. Authenticate with **username + password**
4. Enter `/admin/r2`
5. Upload to R2, sync object metadata, review draft records, publish entries

## Local development
```bash
cp .env.example .env
npm install
npm run check
npm run dev
```

## Demo scaffold note
This repository may still include demo/placeholder data in `src/data/files.json` for local/dev purposes. Treat them as scaffold data, not production content.
