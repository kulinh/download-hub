# Cutover Runbook — host `alpha`

Target host pattern:
- Host: `alpha`
- Legacy app path: `/home/download-888vn/htdocs/download.888vn.net`
- Canonical target: Docker/Portainer + CloudPanel reverse proxy + R2

Goal:
- stop serving from legacy app/runtime
- keep CloudPanel as TLS edge only
- serve the new stack from `127.0.0.1:3000`
- keep metadata persisted, keep files in R2

## 1) Pre-cutover snapshot
- [ ] Confirm Portainer stack is already deployed and healthy on `alpha`
- [ ] Confirm host metadata dir exists: `/opt/download-hub/data/files.json`
- [ ] Back up legacy files from `/home/download-888vn/htdocs/download.888vn.net`:
  - [ ] `.env`
  - [ ] `src/data/files.json`
  - [ ] `storage/files/` if it exists
  - [ ] any PM2/ecosystem file if it exists
- [ ] Export current CloudPanel/Nginx vhost for `download.888vn.net`
- [ ] Freeze admin writes on the old instance

## 2) Data reconciliation before traffic switch
- [ ] Treat legacy truth as `/home/download-888vn/htdocs/download.888vn.net/src/data/files.json`, not repo sample data
- [ ] Compare legacy catalog with real objects in R2
- [ ] Upload any missing production files to R2 before cutover
- [ ] Copy final approved catalog to `/opt/download-hub/data/files.json`
- [ ] Make sure no demo/placeholder rows stay published

## 3) Stop old runtime on `alpha`
Use whatever the host is actually using; do not guess.
- [ ] If PM2 was used, stop the old app from the legacy folder
- [ ] If CloudPanel was managing Node directly, stop that app in CloudPanel
- [ ] Verify old runtime is no longer binding the production app port/process

Legacy path to inspect if needed:
- `/home/download-888vn/htdocs/download.888vn.net`

## 4) Confirm new Docker app is the only upstream
- [ ] In Portainer, stack `download-hub` shows healthy `download-hub-app`
- [ ] Host check passes: `curl http://127.0.0.1:3000/health`
- [ ] App is bound only on localhost, not public interfaces

## 5) Switch CloudPanel/Nginx on `alpha`
- [ ] Open CloudPanel site config for `download.888vn.net`
- [ ] Replace old Node/PM2 upstream with `http://127.0.0.1:3000`
- [ ] Use `deploy/nginx-download-888vn.conf` as the base
- [ ] Keep TLS termination in CloudPanel/Nginx
- [ ] Keep buffering disabled for download streaming
- [ ] Reload Nginx successfully

## 6) Immediate post-cutover validation
Run in this order:
- [ ] `curl http://127.0.0.1:3000/health`
- [ ] `curl -I https://download.888vn.net/health`
- [ ] Homepage renders
- [ ] Detail page renders
- [ ] Turnstile appears and verify passes
- [ ] `/admin/login` renders hCaptcha
- [ ] Login succeeds and redirects to `/admin/r2`
- [ ] `GET /api/admin/r2/status` shows configured
- [ ] `GET /api/admin/r2/files` returns expected inventory
- [ ] Upload URL + confirm works
- [ ] Metadata edit works
- [ ] Publish/unpublish works
- [ ] One real published file downloads end-to-end
- [ ] Expired token returns 403

## 7) Rollback trigger
Rollback immediately if any of these are true:
- [ ] localhost health fails on the container
- [ ] external health fails after Nginx switch
- [ ] admin login works but R2 inventory is broken
- [ ] published file download fails for real production objects
- [ ] wrong catalog/demo data is exposed

## 8) Rollback on `alpha`
- [ ] Point CloudPanel/Nginx back to the old upstream/config
- [ ] Stop the Docker stack if it is the source of failure
- [ ] Restore legacy `.env` / `files.json` if they were changed
- [ ] Restart the old runtime from `/home/download-888vn/htdocs/download.888vn.net`
- [ ] Re-test health, admin login, and one real download

## 9) Done criteria
- [ ] Production traffic reaches only Docker app on `127.0.0.1:3000`
- [ ] Legacy runtime at `/home/download-888vn/htdocs/download.888vn.net` stays off
- [ ] CloudPanel is reverse proxy only
- [ ] R2-backed admin and public flows both pass
- [ ] Backups of legacy app/cfg remain available until sign-off
