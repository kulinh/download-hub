# Portainer UI Checklist — deploy `download-hub`

Use this for the canonical production shape:
- Docker app in Portainer
- CloudPanel/Nginx on host proxies to `127.0.0.1:3000`
- Cloudflare R2 is primary storage
- Turnstile on public flow, hCaptcha on admin login

## Before opening Portainer
- [ ] Repo/worktree is present on the Docker host
- [ ] Host folder exists for metadata catalog: `/opt/download-hub/data`
- [ ] Seed `files.json` once:
  - [ ] `mkdir -p /opt/download-hub/data`
  - [ ] copy repo `src/data/files.json` to `/opt/download-hub/data/files.json`
- [ ] Production values are ready: `APP_BASE_URL`, `APP_HOSTNAME`, `DOWNLOAD_TOKEN_SECRET`, `ADMIN_*`, `TURNSTILE_*`, `HCAPTCHA_*`, `R2_*`

## Portainer click path
1. Open **Portainer**.
2. Open **Stacks**.
3. Click **Add stack**.
4. **Name**: `download-hub`.
5. In **Build method / Web editor**, paste `deploy/portainer-stack.yml`.
6. In **Environment variables**, add these minimum keys:
   - `NODE_ENV=production`
   - `APP_BASE_URL=https://download.888vn.net`
   - `APP_HOSTNAME=download.888vn.net`
   - `APP_PORT=3000`
   - `TRUST_PROXY=loopback`
   - `DOWNLOAD_TOKEN_SECRET=...`
   - `ADMIN_USERNAME=...`
   - `ADMIN_PASSWORD=...`
   - `ADMIN_SESSION_SECRET=...`
   - `TURNSTILE_ENABLED=true`
   - `TURNSTILE_SITE_KEY=...`
   - `TURNSTILE_SECRET_KEY=...`
   - `TURNSTILE_ACTION=download_gate`
   - `HCAPTCHA_ENABLED=true`
   - `HCAPTCHA_SITE_KEY=...`
   - `HCAPTCHA_SECRET_KEY=...`
   - `HCAPTCHA_EXPECTED_HOSTNAME=download.888vn.net`
   - `R2_ENABLED=true`
   - `R2_ACCOUNT_ID=...`
   - `R2_ACCESS_KEY_ID=...`
   - `R2_SECRET_ACCESS_KEY=...`
   - `R2_BUCKET=download-hub-files`
   - `DOWNLOAD_HUB_DATA_DIR=/opt/download-hub/data`
   - `USE_X_ACCEL_REDIRECT=false`
7. Leave image/build defaults from the stack as-is unless you intentionally use a prebuilt image.
8. Click **Deploy the stack**.

## After deploy in Portainer
- [ ] Open stack `download-hub`
- [ ] Confirm container `download-hub-app` is **running**
- [ ] Confirm **Published ports** shows `127.0.0.1:3000:3000`
- [ ] Open **Container details** → check **Health** is `healthy`
- [ ] Open **Logs** → no boot errors for missing env, captcha, or R2 config

## Host-side checks after Portainer deploy
- [ ] `curl http://127.0.0.1:3000/health` returns 200
- [ ] CloudPanel site proxies to `http://127.0.0.1:3000`
- [ ] Nginx reload succeeds
- [ ] `https://download.888vn.net/health` returns 200

## Browser smoke test
- [ ] Homepage loads
- [ ] Detail page loads
- [ ] Turnstile appears on public download flow
- [ ] `/admin/login` renders hCaptcha
- [ ] Admin login succeeds and lands on `/admin/r2`
- [ ] R2 status and file list load
- [ ] Upload URL + confirm flow works
- [ ] Publish/unpublish works
- [ ] One published file downloads successfully

## Red flags
- If Portainer deploys but app is unhealthy: check missing env first.
- If `/admin/r2` fails after login: check `ADMIN_SESSION_SECRET`, cookie, and R2 env.
- If uploads/listing fail: check `R2_*` values and bucket permissions.
- If public site fails but localhost health works: CloudPanel/Nginx upstream is wrong, not the container.
