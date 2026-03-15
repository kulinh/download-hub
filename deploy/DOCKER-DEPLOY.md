# Docker Deployment Guide — download-hub

## Architecture

```
CloudPanel Nginx (host, port 443)
    ↓ reverse-proxy to 127.0.0.1:3000
Docker container: download-hub-app
    ↓ R2 API calls
Cloudflare R2 (object storage)
```

**Key design choices:**
- **Runtime**: Docker (Portainer-friendly via `docker-compose.yml`)
- **Reverse proxy**: CloudPanel Nginx on host (NOT in the stack)
- **Storage**: Cloudflare R2 (S3-compatible). No local file blob volume in production.
- **Public captcha**: Cloudflare Turnstile
- **Admin captcha**: hCaptcha (on login page)
- **Admin auth**: username + password + hCaptcha → HMAC-signed session cookie

---

## Prerequisites

- Docker + Docker Compose v2 (or Portainer with Stack support)
- CloudPanel with a Node.js site for `download.888vn.net` (only for Nginx vhost config)
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
APP_BASE_URL=https://download.888vn.net
APP_HOSTNAME=download.888vn.net
DOWNLOAD_TOKEN_SECRET=<32+ char random string>

# Admin hard auth
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<strong password>
ADMIN_SESSION_SECRET=<32+ char random string>

# Turnstile (public flow)
TURNSTILE_ENABLED=true
TURNSTILE_SITE_KEY=...
TURNSTILE_SECRET_KEY=...

# hCaptcha (admin login)
HCAPTCHA_ENABLED=true
HCAPTCHA_SITE_KEY=...
HCAPTCHA_SECRET_KEY=...

# R2 (production storage)
R2_ENABLED=true
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=download-888vn-files
```

### 2. Build and start

```bash
docker compose up -d --build
```

Or import `docker-compose.yml` as a **Stack** in Portainer.

### 3. Configure CloudPanel Nginx

Paste the contents of `deploy/nginx-download-888vn.conf` into the site's **Vhost** config in CloudPanel.

Then:
```bash
nginx -t && systemctl reload nginx
```

### 4. Verify

```bash
curl -s http://localhost:3000/health
# Expected: {"ok":true,"uptime":...}

# Or via public URL:
curl -I https://download.888vn.net/health
```

---

## Portainer Stack Import

1. Open Portainer → **Stacks** → **Add stack**
2. Select **Upload** or paste `docker-compose.yml` content
3. Add environment variables (from your `.env`) in the **Environment variables** section
4. Deploy the stack

---

## R2 File Workflow

### Upload a file to R2

From the **Admin panel** (`/admin`):
1. Log in with username + password + hCaptcha
2. Click **Upload to R2…**
3. Enter the R2 key (e.g. `windows/myfile.zip`)
4. Select the file → browser PUT directly to R2 via presigned URL

Alternatively, use the AWS CLI / rclone / Cloudflare Dashboard.

### Register file in catalog

After uploading, add an entry to `src/data/files.json`:

```json
{
  "id": "my-file",
  "slug": "my-file",
  "title": { "vi": "My File", "en": "My File" },
  "summary": { "vi": "Mô tả", "en": "Description" },
  "description": { "vi": "...", "en": "..." },
  "version": "1.0.0",
  "platform": "Windows",
  "sizeBytes": 12345678,
  "checksumSha256": "...",
  "mimeType": "application/zip",
  "storage": {
    "r2Key": "windows/myfile.zip",
    "relativePath": "windows/myfile.zip",
    "downloadName": "myfile.zip"
  },
  "published": true,
  "featured": false
}
```

Then reload the catalog from admin panel (**Reload app index**) or:
```bash
docker exec download-hub-app wget -qO- --post-data='{}' \
  --header='Content-Type: application/json' \
  --header='Authorization: Bearer $ADMIN_BEARER_TOKEN' \
  http://localhost:3000/api/admin/reload
```

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
2. `docker compose up -d` (restarts with new env)
3. Re-test: `/health`, captcha verify, one real download
4. Rotate R2 API token in Cloudflare dashboard if needed

---

## Rollback

```bash
# Re-tag previous image or revert code, then:
docker compose up -d --build app
```

---

## Local Development (without Docker)

```bash
cp .env.example .env
# Set NODE_ENV=development, R2_ENABLED=false, TURNSTILE_ENABLED=false, HCAPTCHA_ENABLED=false
npm install
npm run dev
```

Local disk storage (`./storage/files`) is used when `R2_ENABLED=false`.
Admin panel login uses `ADMIN_USERNAME` / `ADMIN_PASSWORD` from `.env` (hCaptcha skipped in dev if not configured).
