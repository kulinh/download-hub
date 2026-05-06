# Operator Guide — download-hub

This is the day-0/day-2 operator guide for the canonical deployment path:
- Runtime: Node.js + PM2 on the host (see `deploy/ecosystem.config.cjs`)
- Reverse proxy: CloudPanel Nginx (TLS termination + proxy)
- Storage: Cloudflare R2 (S3-compatible)
- Public protection: Cloudflare Turnstile → short-lived HMAC download token
- Admin protection: username + password + hCaptcha + signed session cookie

If you need deeper deployment detail, see the deploy references listed below.

## 1) Prerequisites
- Domain + valid HTTPS cert on CloudPanel
- Node.js 20+ and PM2 installed on the host
- Cloudflare R2 account + bucket created
- Turnstile + hCaptcha keys provisioned
- Secrets prepared (see `.env.example`)

## 2) Environment variables (production minimum)
Set these before running:
```
NODE_ENV=production
APP_BASE_URL=https://<your-download-domain>
APP_HOSTNAME=<your-download-domain>
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
HCAPTCHA_EXPECTED_HOSTNAME=<your-download-domain>
R2_ENABLED=true
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=<your-r2-bucket>
```

## 3) Build & run
- `cp .env.example .env` and fill values above.
- First-time install:
  ```bash
  npm ci --omit=dev
  npm run check
  pm2 start deploy/ecosystem.config.cjs --env production
  pm2 save
  curl http://127.0.0.1:3000/health
  ```
- Update / redeploy:
  ```bash
  git pull && npm ci --omit=dev && pm2 restart download-hub
  ```

## 4) Cloudflare R2 CORS — required
Update and apply `deploy/R2-CORS-POLICY.json` before using admin uploads.

1) Edit the policy file:
   - Replace the placeholder origin `https://downloads.example.com` with your real site origin (e.g., `https://download.888vn.net`).
   - Keep methods/headers unless you have a specific need to expand them.

2) Apply the policy to your R2 bucket (pick one):
   - **Cloudflare Dashboard**: R2 → your bucket → Settings → CORS → paste the JSON from `deploy/R2-CORS-POLICY.json` (after updating origin) → Save.
   - **AWS CLI (S3-compatible)**:
     ```bash
     aws s3api put-bucket-cors \
       --endpoint-url https://<accountid>.r2.cloudflarestorage.com \
       --bucket <your-r2-bucket> \
       --cors-configuration file://deploy/R2-CORS-POLICY.json
     ```
     Replace `<accountid>` and `<your-r2-bucket>`, and ensure the file has your updated origin.

3) Verify:
   - From `/admin/r2`, perform a presigned upload; it should succeed without CORS errors in browser console.
   - If errors mention CORS/Preflight, re-check origin and methods in the policy.

## 5) Health & ops checks
- Health endpoint: `GET /health` should return 200.
- Admin login: `/admin/login` → hCaptcha → credentials → session cookie set.
- Admin R2 panel: `/admin/r2` → list files, upload, publish/unpublish.
- Logs: `pm2 logs download-hub` — ensure no auth/storage errors.
- Status: `pm2 list` and `pm2 describe download-hub`.

## 6) Cutover & migration
For migration/cutover steps, see:
- `deploy/OPERATOR-CHECKLIST.md`
- `deploy/MIGRATION-CHECKLIST.md`
- `deploy/MIGRATION-SCRIPTS.md`
- `deploy/CUTOVER-RUNBOOK-ALPHA.md`

## 7) Reverse proxy note
CloudPanel is only the HTTPS terminator and proxy. The Node.js app stays bound to `127.0.0.1:3000`. Use `deploy/nginx-download-hub.conf` as a reference vhost.

## 8) Quick references
- Deployment: `deploy/README.md`, `deploy/ecosystem.config.cjs`, `deploy/nginx-download-hub.conf`
- Storage: `deploy/R2-CORS-POLICY.json` (update origin + apply per section 4), `deploy/STORAGE-STRATEGY.md`
- Release handoff: `deploy/RELEASE-HANDOFF.md`

Keep this guide close to operators; remove any old pipeline artifact copies of OPERATOR.md elsewhere.
