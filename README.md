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

## Production deployment (canonical)
- **Runtime**: Node.js (>=20) launched by PM2
- **Process manager**: PM2 (see `deploy/ecosystem.config.cjs`)
- **Reverse proxy**: CloudPanel custom Nginx vhost (`deploy/nginx-download-hub.conf`)
- **Storage**: Cloudflare R2

```bash
git clone <repo> /opt/download-hub
cd /opt/download-hub
cp .env.example .env       # fill production values
npm ci --omit=dev
npm run check              # validates env + config
pm2 start deploy/ecosystem.config.cjs --env production
pm2 save
```

To update:
```bash
cd /opt/download-hub
git pull
npm ci --omit=dev
pm2 restart download-hub
```

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
