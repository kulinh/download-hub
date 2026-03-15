# download-hub

> **Deploy-ready demo scaffold** cho hệ thống download hub chạy bằng **Docker**, quản trị qua **Portainer**, dùng **CloudPanel chỉ làm reverse proxy**, lưu file trên **Cloudflare R2**, bảo vệ public download bằng **Cloudflare Turnstile**, và bảo vệ admin bằng **username + password + hCaptcha + session cookie**.

## Canonical architecture

```text
Internet
  -> CloudPanel Nginx reverse proxy (HTTPS)
  -> Docker container app (127.0.0.1:3000)
  -> Cloudflare R2 (object storage)
```

### Security model
- **Public download flow**: Turnstile → server verify → issue short-lived HMAC download token → stream/download from R2.
- **Admin flow**: `/admin/login` → username + password + hCaptcha → signed session cookie.
- **Admin APIs**: `/api/admin/r2/*` and related admin ops use session-cookie auth + CSRF protection.
- **Legacy bearer token**: compatibility only, not the primary production flow.

## Stack
- Node.js 20+
- Express 5 + EJS
- Helmet + CSP nonce
- Cloudflare Turnstile (public)
- hCaptcha (admin login)
- Cloudflare R2 via S3-compatible API
- Docker / Docker Compose / Portainer

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
Dockerfile
docker-compose.yml
```

## Production deployment (canonical)
Use this path only:
- **Runtime**: Docker container
- **Orchestration**: Portainer stack or `docker compose`
- **Reverse proxy**: CloudPanel custom Nginx vhost
- **Storage**: Cloudflare R2

See:
- `deploy/DOCKER-DEPLOY.md`
- `deploy/README.md`
- `deploy/OPERATOR-CHECKLIST.md`

## Required production env
Minimum required values:

```env
NODE_ENV=production
APP_BASE_URL=https://download.888vn.net
APP_HOSTNAME=download.888vn.net
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
HCAPTCHA_EXPECTED_HOSTNAME=download.888vn.net

R2_ENABLED=true
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=download-hub-files
```

## Docker quick start
```bash
cp .env.example .env
# fill production-like values or dev values

docker compose up -d --build
curl http://127.0.0.1:3000/health
```

## Portainer quick start
1. Open **Stacks** in Portainer.
2. Create/import stack using `docker-compose.yml`.
3. Supply environment variables.
4. Deploy.
5. Point CloudPanel reverse proxy to `127.0.0.1:3000`.

## CloudPanel reverse proxy
CloudPanel is **not** the app runtime manager in the canonical model.
It only terminates HTTPS and proxies traffic to the container.

Use the nginx sample in:
- `deploy/nginx-download-888vn.conf`

## Admin workflow
1. Visit `/admin/login`
2. Complete **hCaptcha**
3. Authenticate with **username + password**
4. Enter `/admin/r2`
5. Upload to R2, sync object metadata, review draft records, publish entries

## Demo scaffold note
This repository may still include demo/placeholder data in `src/data/files.json` for local/dev purposes. Treat them as scaffold data, not production content.

## Local development / compatibility notes
### Local dev
You can still run without Docker for development:
```bash
cp .env.example .env
npm install
npm run check
npm run dev
```

### Compatibility appendix
The following are **legacy/compatibility paths**, not the primary production story:
- PM2-managed app runtime
- local disk as primary storage
- X-Accel-Redirect as primary production delivery mode
- bearer-token-only admin workflow

Keep them only for migration/backward compatibility, not as the default deployment recommendation.
