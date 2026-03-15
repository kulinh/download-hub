# Portainer Stack — canonical Docker + R2 deployment

Use this when deploying `download-hub` from **Portainer** with the current canonical architecture:
- **Runtime**: Docker / Portainer
- **Reverse proxy**: CloudPanel Nginx on host
- **Primary storage**: Cloudflare R2
- **Public captcha**: Cloudflare Turnstile
- **Admin security**: username + password + hCaptcha + session cookie

The ready-to-paste stack file is:
- `deploy/portainer-stack.yml`

---

## 1. Portainer deployment mode

Recommended:
1. Portainer → **Stacks** → **Add stack**
2. Deploy from the project repository/worktree so the stack can build from:
   - `Dockerfile`
   - `src/`
   - `views/`
   - `public/`
3. Paste/import `deploy/portainer-stack.yml`
4. Set the required environment variables in Portainer
5. Deploy the stack

Why this way:
- the stack uses `build.context: .`
- it stays aligned with the repo's `Dockerfile` and app code
- operators can rebuild in Portainer after code changes

If you prefer prebuilt images later, set `DOWNLOAD_HUB_IMAGE` and remove/ignore the `build` path operationally.

---

## 2. Host path required for metadata catalog

Canonical R2 mode still needs persistent metadata for `FILES_INDEX_PATH`:
- container path: `/app/src/data/files.json`
- default host bind path: `/opt/download-hub/data`

Prepare once on the Docker host:

```bash
mkdir -p /opt/download-hub/data
cp /path/to/download-hub/src/data/files.json /opt/download-hub/data/files.json
```

If you want another host path, override:

```env
DOWNLOAD_HUB_DATA_DIR=/your/path/download-hub/data
```

Important:
- this stack intentionally **does not mount local blob storage**
- canonical production storage is **R2**, not local disk
- `USE_X_ACCEL_REDIRECT` should stay `false` in canonical mode

---

## 3. Required environment variables

Minimum production values:

```env
APP_BASE_URL=https://download.888vn.net
APP_HOSTNAME=download.888vn.net
NODE_ENV=production
TRUST_PROXY=loopback
APP_PORT=3000

DOWNLOAD_TOKEN_SECRET=<long-random-secret>
SESSION_COOKIE_NAME=dl888_session
SESSION_TTL_SECONDS=1200
DOWNLOAD_TOKEN_TTL_SECONDS=120
MAX_BODY_SIZE=20kb
ALLOWED_LOCALES=vi,en

TURNSTILE_ENABLED=true
TURNSTILE_SITE_KEY=...
TURNSTILE_SECRET_KEY=...
TURNSTILE_ACTION=download_gate

HCAPTCHA_ENABLED=true
HCAPTCHA_SITE_KEY=...
HCAPTCHA_SECRET_KEY=...
HCAPTCHA_EXPECTED_HOSTNAME=download.888vn.net

ADMIN_USERNAME=admin
ADMIN_PASSWORD=<strong-password>
ADMIN_SESSION_SECRET=<32+ char random secret>
ADMIN_SESSION_TTL_SECONDS=3600
ADMIN_COOKIE_NAME=dl888_admin_sess

R2_ENABLED=true
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=download-hub-files

DOWNLOAD_HUB_DATA_DIR=/opt/download-hub/data
USE_X_ACCEL_REDIRECT=false
RATE_LIMIT_WINDOW_SECONDS=300
RATE_LIMIT_MAX_ATTEMPTS=20
LOG_REQUESTS=false
```

Optional / compatibility only:

```env
ADMIN_BEARER_TOKEN=
DOWNLOAD_HUB_IMAGE=download-hub:latest
FILES_STORAGE_PATH=./storage/files
X_ACCEL_INTERNAL_PREFIX=/protected-downloads
```

---

## 4. CloudPanel / Nginx side

CloudPanel remains the HTTPS entrypoint and should proxy to:

- `http://127.0.0.1:3000`

Use:
- `deploy/nginx-download-888vn.conf`

This stays aligned with the stack because the container only binds to localhost:
- `127.0.0.1:3000:3000`

---

## 5. Post-deploy verification

After stack deploy, verify:

```bash
curl -s http://127.0.0.1:3000/health
curl -I https://download.888vn.net/health
```

Expected operator checks:
- `/health` returns 200
- homepage renders
- file detail page renders
- Turnstile appears on public flow
- `/admin/login` renders and hCaptcha loads
- login succeeds and redirects to `/admin/r2`
- R2 status/file list loads
- upload-url + upload-confirm flow works
- publish/unpublish works

See also:
- `deploy/DOCKER-DEPLOY.md`
- `deploy/README.md`
- `deploy/OPERATOR-CHECKLIST.md`

---

## 6. Portainer notes

- `container_name` is fixed to `download-hub-app` for operator convenience.
- The stack keeps the same healthcheck/logging/resource limits as `docker-compose.yml`.
- `no-new-privileges:true` and non-root runtime remain in place.
- `tmpfs /tmp` is added for cleaner runtime behavior in Portainer-managed deployments.

---

## 7. Not part of canonical mode

These are compatibility paths only and should not be treated as the default Portainer deployment story:
- PM2 runtime
- local-disk-first blob storage
- X-Accel-Redirect as primary delivery mode
- bearer-token-only admin workflow
