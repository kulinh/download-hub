# Deployment Guide — PM2 + CloudPanel reverse proxy

This file is the **canonical deployment guide** for `download-hub`.

## Target architecture
- **Application runtime**: Node.js (>=20) launched by PM2
- **Process manager**: PM2 (see `deploy/ecosystem.config.cjs`)
- **Reverse proxy / TLS**: CloudPanel Nginx on host (`deploy/nginx-download-hub.conf`)
- **Primary storage**: Cloudflare R2
- **Public anti-bot**: Cloudflare Turnstile
- **Admin security**: username + password + hCaptcha + session cookie

## 1. Prerequisites
- Node.js 20+ and npm on the host
- PM2 (`npm i -g pm2`)
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

## 3. First-time install
```bash
git clone <repo> /opt/download-hub
cd /opt/download-hub
cp .env.example .env       # then edit with production values
npm ci --omit=dev
npm run check              # validates env + config
pm2 start deploy/ecosystem.config.cjs --env production
pm2 save
pm2 startup                # one-time: enable auto-start on boot
```

The app binds on `127.0.0.1:3000`.

Health check:
```bash
curl http://127.0.0.1:3000/health
```

## 4. Update / redeploy
```bash
cd /opt/download-hub
git pull
npm ci --omit=dev
pm2 restart download-hub
```

## 5. CloudPanel reverse proxy
CloudPanel terminates HTTPS and proxies to the local Node.js process at `http://127.0.0.1:3000`.

Use `deploy/nginx-download-hub.conf` as the base vhost. After edits:
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
- restart after env change: `pm2 restart download-hub`

### Admin login captcha fails
- verify hCaptcha keys
- verify expected hostname
- restart after env change

### Admin login succeeds but `/admin/r2` fails
- check session cookie
- check `ADMIN_SESSION_SECRET`
- check CSRF header/body handling in browser requests

### R2 operations fail
- verify `R2_ENABLED=true`
- verify account id / access key / secret / bucket
- inspect logs: `pm2 logs download-hub`

### Reverse proxy issues
- verify CloudPanel vhost points to `127.0.0.1:3000`
- verify HTTPS/TLS termination on host
- verify forwarded headers are preserved

## 8. Operations
### Secret rotation
Rotate and `pm2 restart download-hub` after changing:
- `DOWNLOAD_TOKEN_SECRET`
- `ADMIN_SESSION_SECRET`
- Turnstile secret
- hCaptcha secret
- R2 credentials

### Backup scope
At minimum back up:
- `.env`
- `src/data/files.json`
- nginx vhost config

### Release/update
1. `git pull` new code
2. `npm ci --omit=dev`
3. `pm2 restart download-hub`
4. verify `/health`
5. test admin login + public download

## 9. Compatibility Appendix (Local Disk Mode)
These are **legacy compatibility paths only** and not the primary deployment recommendation:
- Local disk storage instead of Cloudflare R2
- X-Accel-Redirect delivery mode via Nginx
- Legacy bearer-token admin workflow
