# OPERATOR CHECKLIST — download.888vn.net

## 1) DNS + CloudPanel site
- Point `download.888vn.net` A record to the VPS IP.
- Create a **Node.js site** in CloudPanel for `download.888vn.net`.
- Keep this deploy layout:
  - app code: `/home/cloudpanel/htdocs/download-888vn/app`
  - file storage: `/home/cloudpanel/htdocs/download-888vn/storage/files`
- Confirm PM2/CloudPanel runs the app from:
  - `cwd=/home/cloudpanel/htdocs/download-888vn/app`

## 2) Source code + dependencies
- Upload project source into:
  - `/home/cloudpanel/htdocs/download-888vn/app`
- Install deps:
  - `npm install --omit=dev`
- Run preflight before start/restart:
  - `npm run check`
- Runtime requirement:
  - `Node.js >= 20`

## 3) Production .env bắt buộc
Create `.env` from `.env.example` inside the app directory.

Minimum required values:
- `NODE_ENV=production`
- `APP_BASE_URL=https://download.888vn.net`
- `APP_HOSTNAME=download.888vn.net`
- `DOWNLOAD_TOKEN_SECRET=<long-random-secret>`
- `FILES_STORAGE_PATH=/home/cloudpanel/htdocs/download-888vn/storage/files`
- `TRUST_PROXY=loopback`

Admin hard auth (REQUIRED in production):
- `ADMIN_USERNAME=<your-admin-username>`
- `ADMIN_PASSWORD=<your-strong-password>`
- `ADMIN_SESSION_SECRET=<long-random-secret-min-32-chars>`

Optional:
- `ADMIN_BEARER_TOKEN=<random-token>` — **legacy only**, for existing CI/CD pipelines.
  Leave **blank** for new deployments. New code uses session cookie auth.
- `USE_X_ACCEL_REDIRECT=true` if offloading local-disk file serving to Nginx
  (not needed when R2 is enabled)
- `X_ACCEL_INTERNAL_PREFIX=/protected-downloads`

## 4) Captcha secrets
**Two separate captcha providers are required in production:**
- **Public download flow** → Cloudflare Turnstile
- **Admin panel login** → hCaptcha

### Cloudflare Turnstile (public download — REQUIRED)
- `TURNSTILE_ENABLED=true`
- `TURNSTILE_SITE_KEY=...`
- `TURNSTILE_SECRET_KEY=...`
- `TURNSTILE_ACTION=download_gate`

### hCaptcha (admin login — REQUIRED in production)
- `HCAPTCHA_ENABLED=true`
- `HCAPTCHA_SITE_KEY=...`
- `HCAPTCHA_SECRET_KEY=...`
- `HCAPTCHA_EXPECTED_HOSTNAME=download.888vn.net`

After changing captcha secrets:
- restart app
- test a real captcha flow on production domain (both public download and admin login)

## 5) Storage + file publish
- Create storage dir:
  - `/home/cloudpanel/htdocs/download-888vn/storage/files`
- Upload real files via SFTP into the correct subfolders.
- Update `src/data/files.json` with truthful values:
  - `published`
  - `sizeBytes`
  - `checksumSha256`
- If only metadata/files changed, reload index without full restart:
  - `POST /api/admin/reload` with Bearer token
- Confirm the Node/PM2 user has **read access** to all files.

## 6) PM2 / process
Start app:
```bash
pm2 start deploy/ecosystem.config.cjs --env production
pm2 save
```

Quick checks:
```bash
pm2 status
pm2 show download-888vn
pm2 logs download-888vn --lines 100
```

Expected process name:
- `download-888vn`

Common log paths:
- `/var/log/pm2/download-888vn.out.log`
- `/var/log/pm2/download-888vn.err.log`

## 7) Nginx / CloudPanel vhost
- Import/paste `deploy/nginx-download-888vn.conf` into CloudPanel custom vhost config.
- If using Nginx offload, ensure:
  - `USE_X_ACCEL_REDIRECT=true`
  - `location /protected-downloads/` is `internal`
  - `alias` points to:
    - `/home/cloudpanel/htdocs/download-888vn/storage/files/`
- `X_ACCEL_INTERNAL_PREFIX` in `.env` must match the nginx prefix.
- Reverse proxy must pass to:
  - `http://127.0.0.1:3000`
- Preserve headers:
  - `Host`
  - `X-Real-IP`
  - `X-Forwarded-For`
  - `X-Forwarded-Proto`

After nginx changes:
```bash
nginx -t
systemctl reload nginx
```

## 8) HTTPS
- Enable SSL / Let's Encrypt in CloudPanel.
- Confirm HTTP redirects to HTTPS.
- Make sure `APP_BASE_URL` uses the final HTTPS URL.
- Re-test full site over HTTPS only.

## 9) Validation before handoff
- `GET /health` returns `200` and `{"ok":true,...}`
- Homepage renders normally
- Detail page renders normally
- **Admin login**: `GET /admin/login` renders with hCaptcha widget
- **Admin login**: submit with valid credentials + hCaptcha → redirects to `/admin/r2`
- **Admin logout**: session cookie cleared, redirects to `/admin/login`
- **Admin API 401**: `GET /api/admin/r2/files` without cookie → `{"ok":false,"error":"admin_session_required"}`
- **Admin API 200**: `GET /api/admin/r2/files` with valid session cookie → file list
- Public Turnstile renders with the Turnstile widget
- Turnstile verify succeeds and returns a `downloadUrl`
- At least one real file downloads end-to-end
- Expired link or mismatched client gets blocked (`403`)
- `robots.txt` works
- `/.well-known/security.txt` works
- `pm2 status` shows no restart loop
- logs show no boot/runtime errors

## 10) Troubleshooting quick runbook
### Admin login fails (captcha error)
Check:
- `HCAPTCHA_ENABLED=true` and keys are correct
- `HCAPTCHA_EXPECTED_HOSTNAME` matches production domain
- app restarted after env change

### Public captcha verify fails
Check:
- `TURNSTILE_ENABLED=true` and Turnstile site key / secret key are correct
- hostname matches `download.888vn.net`
- app restarted after env change
- `TURNSTILE_ACTION` matches the action set in Cloudflare dashboard

### Admin login redirects back to login page (session not established)
Check:
- `ADMIN_SESSION_SECRET` is set and non-placeholder
- `ADMIN_COOKIE_NAME` is consistent across restarts
- browser allows cookies from the production domain (no private mode issue)
- session TTL not expired (`ADMIN_SESSION_TTL_SECONDS`)

### X-Accel-Redirect download fails
Check:
- `USE_X_ACCEL_REDIRECT=true`
- nginx `internal` location exists
- `alias` matches real storage path
- `X_ACCEL_INTERNAL_PREFIX` matches nginx prefix
- nginx reloaded after config change

### 403 invalid / expired token
Check:
- token TTL not exceeded
- same browser / same User-Agent
- same client IP path through proxy
- `TRUST_PROXY` is correct

### Missing storage path / ENOENT
Check:
- `FILES_STORAGE_PATH` is absolute in production
- file actually exists on disk
- `files.json` path and filename match the real file
- PM2 user has read permission

### PM2 debugging
```bash
pm2 status
pm2 show download-888vn
pm2 logs download-888vn --lines 100
```

## 11) Ops / maintenance
### Secret rotation
- rotate Turnstile secret key
- rotate hCaptcha secret key
- rotate `DOWNLOAD_TOKEN_SECRET`
- rotate `ADMIN_SESSION_SECRET`
- rotate `ADMIN_BEARER_TOKEN` if in use (legacy)
- restart app after rotation
- re-test admin login, public captcha + download flow

### Backup scope
Back up at minimum:
- `app/.env`
- `app/src/data/files.json`
- `storage/files/`
- custom nginx vhost config

### Release / update procedure
1. Back up files above
2. Upload/update app code in `app/`
3. Run `npm install --omit=dev` if dependencies changed
4. Run `npm run check`
5. Restart PM2 app
6. Re-test `/health`, captcha flow, and one real download

## 12) Rollback basics
If release breaks:
- restore previous code in `app/`
- restore previous `files.json` / storage files if needed
- restore previous nginx config if needed
- run:
  - `nginx -t && systemctl reload nginx`
  - `pm2 restart download-888vn`
- re-test `/health`, captcha verify, and one real download before reopening traffic
