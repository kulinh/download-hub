# OPERATOR CHECKLIST — download-hub

## Canonical Mode (R2 Storage)
Use this checklist for the **primary deployment model**:
- Docker / Docker Compose / Portainer
- CloudPanel only as reverse proxy
- Cloudflare R2 as primary storage
- Turnstile for public flow
- username + password + hCaptcha + session cookie for admin

## 1) DNS + Reverse Proxy
- `download.888vn.net` points to the correct VPS IP
- CloudPanel vhost exists for `download.888vn.net`
- CloudPanel proxies to `127.0.0.1:3000`
- HTTPS is enabled and valid

## 2) Docker / Portainer
- stack uses `docker-compose.yml`
- container builds successfully
- app binds to `127.0.0.1:3000`
- healthcheck passes

## 3) Production Environment Variables
Must be set:
- `NODE_ENV=production`
- `APP_BASE_URL=https://download.888vn.net`
- `APP_HOSTNAME=download.888vn.net`
- `DOWNLOAD_TOKEN_SECRET`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `ADMIN_SESSION_SECRET`
- `TURNSTILE_*`
- `HCAPTCHA_*`
- `R2_*`

## 4) Cloudflare R2 Configuration
- bucket exists
- credentials valid
- bucket name correct
- upload flow works from `/admin/r2`
- file list returns expected objects

## 5) Public Download Flow
- homepage loads
- detail page loads
- Turnstile renders
- verify flow succeeds
- published file downloads successfully
- expired token returns 403

## 6) Admin Operations Flow
- `/admin/login` loads
- hCaptcha renders
- username/password login succeeds
- session cookie is set
- `/admin/r2` loads
- metadata edit works
- publish/unpublish works
- logout clears session

## 7) Logs & Health Check
- `/health` returns 200
- container logs are clean
- reverse proxy logs show healthy upstream behavior

## 8) Compatibility Mode (Local Disk Storage)
Only if intentionally needed for local legacy deployment:
- PM2 runtime instead of Docker
- Local disk storage (requires `R2_ENABLED=false`)
- X-Accel-Redirect as primary delivery path (requires `USE_X_ACCEL_REDIRECT=true`)
- Requires directory mounts for `/storage/files`
