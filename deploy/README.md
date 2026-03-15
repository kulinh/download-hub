# Deployment Guide — Docker / Portainer / CloudPanel reverse proxy

This file is the **canonical deployment guide** for `download-hub`.

## Target architecture
- **Application runtime**: Docker container
- **Stack orchestration**: Portainer or `docker compose`
- **Reverse proxy / TLS**: CloudPanel Nginx on host
- **Primary storage**: Cloudflare R2
- **Public anti-bot**: Cloudflare Turnstile
- **Admin security**: username + password + hCaptcha + session cookie

## 1. Prerequisites
- Docker + Docker Compose v2, or Portainer Stack support
- CloudPanel site / vhost for `downloads.example.com`
- Cloudflare R2 bucket and API credentials
- Turnstile site/secret key
- hCaptcha site/secret key

## 2. Prepare `.env`
Copy and edit:
```bash
cp .env.example .env
```

Required production values:
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

## 3. Deploy with Docker Compose
```bash
docker compose up -d --build
```

Expected app bind:
- `127.0.0.1:3000`

Health check:
```bash
curl http://127.0.0.1:3000/health
```

## 4. Deploy with Portainer
1. Open **Stacks**
2. Create stack
3. Import or paste `docker-compose.yml`
4. Add env vars from `.env`
5. Deploy stack

## 5. CloudPanel reverse proxy
CloudPanel should proxy HTTPS traffic to the app container at:
- `http://127.0.0.1:3000`

Use `deploy/nginx-download-888vn.conf` as the base vhost customization.
After edits:
```bash
nginx -t && systemctl reload nginx
```

## 6. Validation checklist
- `GET /health` returns 200
- homepage renders
- detail page renders
- Turnstile appears on public flow
- admin login page renders hCaptcha
- admin login succeeds with username/password+hCaptcha
- `/admin/r2` opens after login
- R2 file list loads
- upload-url + upload-confirm flow works
- publish/unpublish metadata flow works
- public download flow returns a working file for a published entry
- expired token returns 403

## 7. Troubleshooting
### Public captcha fails
- verify Turnstile keys
- verify hostname and action
- restart container after env change

### Admin login captcha fails
- verify hCaptcha keys
- verify expected hostname
- restart container after env change

### Admin login succeeds but `/admin/r2` fails
- check session cookie
- check `ADMIN_SESSION_SECRET`
- check CSRF header/body handling in browser requests

### R2 operations fail
- verify `R2_ENABLED=true`
- verify account id / access key / secret / bucket
- inspect container logs

### Reverse proxy issues
- verify CloudPanel vhost points to `127.0.0.1:3000`
- verify HTTPS/TLS termination on host
- verify forwarded headers are preserved

## 8. Operations
### Secret rotation
Rotate and redeploy/restart after changing:
- `DOWNLOAD_TOKEN_SECRET`
- `ADMIN_SESSION_SECRET`
- Turnstile secret
- hCaptcha secret
- R2 credentials

### Backup scope
At minimum back up:
- `.env`
- `src/data/files.json`
- container compose/vhost config

### Release/update
1. pull new code / update stack
2. rebuild container
3. restart stack
4. verify `/health`
5. test admin login + public download

## 9. Compatibility appendix
These are **legacy compatibility paths only** and not the primary deployment recommendation:
- PM2-managed runtime
- local-disk-first storage
- X-Accel-Redirect-first delivery mode
- bearer-token-only admin workflow
