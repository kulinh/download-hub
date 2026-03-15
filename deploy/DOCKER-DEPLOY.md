# Docker Deployment Guide — download-hub

## Architecture

```text
CloudPanel Nginx (host, port 443)
    ↓ reverse-proxy to 127.0.0.1:3000
Docker container: download-hub-app
    ↓ R2 API calls
Cloudflare R2 (object storage)
```

**Key design choices:**
- **Runtime**: Docker (Portainer-friendly via `docker-compose.yml`)
- **Reverse proxy**: CloudPanel Nginx on host (NOT in the stack)
- **Storage**: Cloudflare R2 (S3-compatible). No local file blob volume in canonical production mode.
- **Public captcha**: Cloudflare Turnstile
- **Admin captcha**: hCaptcha (on admin login page)
- **Admin auth**: username + password + hCaptcha → HMAC-signed session cookie

---

## Prerequisites

- Docker + Docker Compose v2 (or Portainer with Stack support)
- CloudPanel with a vhost / reverse proxy for `downloads.example.com`
- Cloudflare R2 bucket + API token (Read + Write)
- Cloudflare Turnstile site/secret key pair
- hCaptcha site/secret key pair

---

## Quick Start

### 1. Prepare `.env`

```bash
cp .env.example .env
# Edit .env — fill ALL required values
```

Minimum required for production:
```env
NODE_ENV=production
APP_BASE_URL=https://downloads.example.com
APP_HOSTNAME=downloads.example.com
DOWNLOAD_TOKEN_SECRET=<32+ char random string>

# Admin hard auth
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<strong password>
ADMIN_SESSION_SECRET=<32+ char random string>

# Turnstile (public flow)
TURNSTILE_ENABLED=true
TURNSTILE_SITE_KEY=...
TURNSTILE_SECRET_KEY=...
TURNSTILE_ACTION=download_gate

# hCaptcha (admin login)
HCAPTCHA_ENABLED=true
HCAPTCHA_SITE_KEY=...
HCAPTCHA_SECRET_KEY=...
HCAPTCHA_EXPECTED_HOSTNAME=downloads.example.com

# R2 (production storage)
R2_ENABLED=true
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=your-r2-bucket-name
```

### 2. Build and start

```bash
docker compose up -d --build
```

Or import `docker-compose.yml` as a **Stack** in Portainer.

### 3. Configure CloudPanel Nginx

Paste the contents of `deploy/nginx-download-hub.conf` into the site's **Vhost** config in CloudPanel.

Then:
```bash
nginx -t && systemctl reload nginx
```

### 4. Verify

```bash
curl -s http://localhost:3000/health
# Expected: {"ok":true,"uptime":...}

curl -I https://downloads.example.com/health
```

---

## Portainer Stack Import

1. Open Portainer → **Stacks** → **Add stack**
2. Select **Upload** or paste `docker-compose.yml` content
3. Add environment variables from your `.env`
4. Deploy the stack

---

## Canonical R2 Admin Workflow

### Login to admin
Use the browser admin entrypoint:
- `GET /admin/login`

Flow:
1. Enter **username + password**
2. Complete **hCaptcha**
3. Successful login redirects to:
   - `GET /admin/r2`

### Upload a file to R2
From **`/admin/r2`**:
1. Log in via `/admin/login`
2. Open the R2 management UI
3. Click **Upload to R2**
4. Enter the R2 object key, e.g. `windows/myfile.zip`
5. Browser uploads via presigned PUT URL

### Manage catalog / publish flow
The canonical production workflow is now:
- upload object to R2
- use `/admin/r2` session-authenticated UI/APIs to inspect/sync/update metadata
- publish/unpublish entries from the admin UI

Primary admin API surface:
- `GET /api/admin/r2/status`
- `GET /api/admin/r2/files`
- `POST /api/admin/r2/sync`
- `POST /api/admin/r2/upload-url`
- `POST /api/admin/r2/upload-confirm`
- `PATCH /api/admin/r2/files/:slug/publish`
- `PATCH /api/admin/r2/files/:slug/metadata`
- `DELETE /api/admin/r2/files/:slug`

These APIs are protected by:
- admin session cookie
- CSRF checks on mutating requests

---

## Validation checklist

- `/health` returns 200
- homepage renders
- file detail page renders
- Turnstile appears on public download flow
- `/admin/login` renders username/password + hCaptcha
- successful login redirects to `/admin/r2`
- R2 inventory/status loads in admin UI
- presigned upload flow works
- metadata update works
- publish/unpublish works
- public download works for a published object
- expired token returns 403

---

## Container Operations

```bash
# View logs
docker compose logs -f app

# Restart
docker compose restart app

# Rebuild after code change
docker compose up -d --build app

# Enter container
docker exec -it download-hub-app sh

# Health check
docker inspect download-hub-app | grep -A5 '"Health"'
```

---

## Secret Rotation

1. Update `.env` with new secrets
2. `docker compose up -d` (restart with new env)
3. Re-test `/health`, admin login, public captcha verify, and one real download
4. Rotate R2 API token in Cloudflare dashboard if needed

---

## Rollback

```bash
# Re-tag previous image or revert code, then:
docker compose up -d --build app
```

---

## Local Development (compatibility)

```bash
cp .env.example .env
npm install
npm run dev
```

For local dev only, you may disable R2/captcha and use fallback settings. This is not the canonical production mode.

---

## Compatibility Appendix

The following are compatibility / maintenance paths only, not the primary production story:
- manual editing of `src/data/files.json`
- legacy bearer-token admin automation
- local-disk-first storage workflows
- PM2-managed runtime outside Docker
- X-Accel-Redirect-first delivery mode

If you keep compatibility automation for maintenance, document it separately and do not treat it as the default production operator path.
