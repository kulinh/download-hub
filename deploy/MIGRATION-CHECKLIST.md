# Migration Checklist — local-disk/PM2/CloudPanel → Docker/R2 canonical deployment

Use this when moving an existing live instance from:
- PM2 or CloudPanel-managed Node runtime
- local disk file storage under `storage/files`
- optional `X-Accel-Redirect` local delivery
- legacy bearer-token/disk admin habits

to the canonical production model:
- Docker container
- Portainer stack or `docker compose`
- CloudPanel only as reverse proxy / TLS edge
- Cloudflare R2 as primary object storage
- session-authenticated `/admin/r2` workflow

---

## 0) Pre-migration facts to confirm

- [ ] Current live app path is known (example legacy PM2 config points to `/home/cloudpanel/htdocs/download-888vn/app` in `deploy/ecosystem.config.cjs`)
- [ ] Current PM2 app name / CloudPanel site name is known
- [ ] Current live `.env` is backed up
- [ ] Current live `src/data/files.json` is backed up
- [ ] Current live `storage/files/` tree is identified
- [ ] Current domain / vhost is confirmed (`download.888vn.net`)
- [ ] Current Nginx vhost customizations are exported
- [ ] Current catalog entries were reviewed for demo/placeholder rows before migration

> Note: this repo still contains demo/placeholder `files.json` examples. Do not treat repo sample data as production truth. Export from the live server first.

---

## 1) Backup before touching anything

- [ ] Copy live `.env` to a dated backup
- [ ] Copy live `src/data/files.json` to a dated backup
- [ ] Archive live `storage/files/`
- [ ] Export current PM2 config / process info
- [ ] Export current CloudPanel/Nginx vhost config
- [ ] Record current app health and a known-good public download URL

Suggested backup set:

```bash
mkdir -p /root/backups/download-hub-$(date +%F)
cp .env /root/backups/download-hub-$(date +%F)/env.backup
cp src/data/files.json /root/backups/download-hub-$(date +%F)/files.json.backup
cp -a storage/files /root/backups/download-hub-$(date +%F)/storage-files.backup
```

If PM2 is in use, also capture:

```bash
pm2 status
pm2 show download-888vn
pm2 save
```

---

## 2) Freeze writes on the old system

Goal: stop catalog drift while exporting and uploading.

- [ ] Announce a short maintenance window
- [ ] Stop all admin writes on the old instance
- [ ] Do not upload new files to `storage/files/` during migration
- [ ] Do not edit `files.json` during migration
- [ ] If needed, temporarily block admin access or stop PM2 app after backup/export

Practical choices:
- safest: stop PM2 app after taking backups
- acceptable: keep public reads up briefly, but freeze admin writes immediately

Example:

```bash
pm2 stop download-888vn
```

If CloudPanel started the Node app instead of PM2, stop it from CloudPanel UI before proceeding.

---

## 3) Export the live catalog and map disk files

The migration source of truth should be:
- live `src/data/files.json`
- actual files present under live `storage/files/`

Checklist:
- [ ] Export live `files.json`
- [ ] List every object currently under `storage/files/`
- [ ] Compare catalog entries vs on-disk files
- [ ] Identify orphans on disk not present in `files.json`
- [ ] Identify catalog entries pointing to missing files
- [ ] Mark demo / placeholder rows that should not be published after migration
- [ ] Decide final R2 key naming for each file, ideally preserving relative paths

Recommended mapping rule:
- local `storage/files/windows/foo.zip` → R2 key `windows/foo.zip`
- local `storage/files/android/bar.apk` → R2 key `android/bar.apk`

This keeps `storage.relativePath` and future `storage.r2Key` easy to reason about.

---

## 4) Upload objects from local disk to R2

Create and validate the target bucket first.

- [ ] R2 bucket exists
- [ ] R2 API credentials are created and tested
- [ ] Bucket name matches intended production `.env`
- [ ] Upload all real objects from local disk to R2
- [ ] Preserve relative paths as object keys where possible
- [ ] Verify object count and total size after upload
- [ ] Spot-check a few large and small files

Minimum env that must exist for canonical production:

```env
R2_ENABLED=true
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=download-hub-files
```

Important:
- `storage/files/` becomes compatibility/fallback only, not primary production storage
- `USE_X_ACCEL_REDIRECT` should remain `false` in canonical R2 mode
- keep local disk backup until post-cutover validation is complete

---

## 5) Update catalog metadata for R2 mode

Before cutover, ensure the catalog matches uploaded objects.

- [ ] Every production entry has the correct file size
- [ ] Every production entry has the correct SHA-256 checksum
- [ ] Every production entry has the correct filename / download name
- [ ] Every production entry points to the intended object path
- [ ] Publish state is reviewed intentionally; no accidental publish of placeholders
- [ ] Demo rows are unpublished or removed if not meant for production

Preferred target state per entry:
- keep metadata in `src/data/files.json`
- ensure the app can associate each catalog entry with the uploaded R2 object
- after deploy, use `/admin/r2` + `POST /api/admin/r2/sync` if needed to reconcile inventory

---

## 6) Prepare the new Docker env

Use `.env.example` as the baseline and fill production values.

- [ ] `NODE_ENV=production`
- [ ] `APP_BASE_URL=https://download.888vn.net`
- [ ] `APP_HOSTNAME=download.888vn.net`
- [ ] `TRUST_PROXY=loopback`
- [ ] `DOWNLOAD_TOKEN_SECRET` rotated to a strong new value
- [ ] `ADMIN_USERNAME` set
- [ ] `ADMIN_PASSWORD` set
- [ ] `ADMIN_SESSION_SECRET` rotated to a strong new value
- [ ] `TURNSTILE_*` configured
- [ ] `HCAPTCHA_*` configured
- [ ] `R2_*` configured
- [ ] `ADMIN_BEARER_TOKEN` left blank unless legacy compatibility is intentionally needed
- [ ] `R2_ENABLED=true`
- [ ] `USE_X_ACCEL_REDIRECT=false`

Do not carry over old assumptions that:
- PM2 manages the app runtime
- local disk is the primary source of file truth
- bearer token is the main admin auth method

---

## 7) Deploy the Docker stack in Portainer

Canonical stack source:
- `docker-compose.yml`
- `Dockerfile`

Checklist:
- [ ] Create/import stack in Portainer
- [ ] Load the final production env values
- [ ] Deploy container
- [ ] Confirm container is healthy
- [ ] Confirm bind is `127.0.0.1:3000`
- [ ] Confirm logs are clean

If using CLI instead of Portainer:

```bash
docker compose up -d --build
curl http://127.0.0.1:3000/health
```

Expected:
- app container name: `download-hub-app`
- reverse proxy target: `http://127.0.0.1:3000`

---

## 8) Switch CloudPanel/Nginx to the Docker app

CloudPanel should become reverse proxy only.

- [ ] Replace old Node/PM2 upstream assumptions with `127.0.0.1:3000`
- [ ] Use `deploy/nginx-download-888vn.conf` as the base config
- [ ] Keep HTTPS/TLS termination on CloudPanel/Nginx host
- [ ] Keep forwarded headers enabled
- [ ] Keep buffering disabled for download streams
- [ ] Keep local `X-Accel-Redirect` block disabled unless intentionally running fallback mode
- [ ] Test config
- [ ] Reload Nginx

Command:

```bash
nginx -t && systemctl reload nginx
```

After switch:
- old PM2 app should stay stopped
- only the Docker container should serve production traffic

---

## 9) Validation after cutover

Validate in this order.

### Platform health
- [ ] `GET /health` returns 200 locally
- [ ] `GET https://download.888vn.net/health` returns 200 externally
- [ ] homepage renders
- [ ] file detail page renders

### Public download flow
- [ ] Turnstile renders
- [ ] captcha verify succeeds
- [ ] published file returns a real working download
- [ ] expired token returns 403

### Admin flow
- [ ] `/admin/login` renders
- [ ] hCaptcha renders
- [ ] login succeeds with username/password + hCaptcha
- [ ] session cookie is set
- [ ] `/admin/r2` loads
- [ ] `GET /api/admin/r2/status` reports configured
- [ ] `GET /api/admin/r2/files` returns expected inventory
- [ ] upload-url + upload-confirm flow works
- [ ] metadata edit works
- [ ] publish/unpublish works
- [ ] logout clears session

### Data validation
- [ ] R2 inventory matches expected migrated object set
- [ ] Catalog entries do not point at missing files
- [ ] No placeholder/demo row is accidentally published
- [ ] A few representative files download correctly from end to end

---

## 10) Rollback plan

If cutover fails, revert fast instead of improvising.

Rollback assets to keep until migration is signed off:
- old `.env`
- old `src/data/files.json`
- full `storage/files/` backup
- old PM2 config / process name
- old Nginx/CloudPanel config

Rollback steps:
- [ ] Point CloudPanel/Nginx back to the old runtime/config
- [ ] Stop the Docker stack
- [ ] Restore previous `.env` and `files.json` if they were changed on the old app
- [ ] Start old PM2 app again
- [ ] Re-test `/health`, admin login, and one real download

Typical commands:

```bash
docker compose down
pm2 start deploy/ecosystem.config.cjs --env production
nginx -t && systemctl reload nginx
```

If rollback is needed because migrated data is wrong:
- restore old catalog backup
- keep R2 bucket contents for forensic review, but do not switch traffic back to them until reconciled

---

## 11) Post-migration cleanup

Only do this after stable validation.

- [ ] Keep a dated migration report with object count, catalog count, and cutover time
- [ ] Disable or retire the old PM2 process permanently
- [ ] Remove obsolete CloudPanel app-runtime settings if no longer used
- [ ] Document that Docker/R2 is now canonical production mode
- [ ] Keep local disk backups for a defined retention period before deletion

---

## Operator shorthand

1. Backup old env + catalog + files
2. Freeze writes
3. Export catalog and inventory local files
4. Upload local objects to R2
5. Reconcile catalog metadata
6. Fill final production `.env`
7. Deploy Docker stack in Portainer
8. Switch CloudPanel proxy to `127.0.0.1:3000`
9. Validate public flow + `/admin/r2`
10. Roll back immediately if validation fails
