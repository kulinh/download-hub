# Cutover Runbook — host `alpha`

Target topology:
- Edge/TLS: CloudPanel Nginx on host `alpha`
- Upstream app: Docker/Portainer container `download-hub-app`
- App bind: `127.0.0.1:3000`
- Metadata bind mount: `/opt/download-hub/data/files.json`
- Object storage: Cloudflare R2
- Public gate: Cloudflare Turnstile
- Admin auth: username + password + hCaptcha + session cookie

Goal:
- stop serving traffic from the legacy runtime
- switch CloudPanel to the Docker upstream only
- keep the final metadata catalog on host disk
- keep production file objects in R2
- leave a clean rollback path

## 0) Hard stop conditions before cutover
Do not switch traffic until all are true:
- [ ] Portainer stack is deployed on `alpha`
- [ ] `curl http://127.0.0.1:3000/health` returns 200 on `alpha`
- [ ] `/opt/download-hub/data/files.json` contains the final approved production catalog
- [ ] R2 bucket contains all real production objects referenced by the catalog
- [ ] Turnstile keys are real production keys
- [ ] hCaptcha keys are real production keys
- [ ] admin username/password were set to real production values
- [ ] old runtime owner is aware of the write freeze window

## 1) Pre-cutover backup + freeze
Legacy path:
- `/home/download-888vn/htdocs/download.888vn.net`

Take backups before touching traffic:
- [ ] Back up legacy `.env`
- [ ] Back up legacy `src/data/files.json`
- [ ] Back up legacy `storage/files/` if present
- [ ] Back up any PM2/ecosystem config if present
- [ ] Export current CloudPanel vhost for `download.888vn.net`
- [ ] Confirm no one is editing metadata in the old admin UI
- [ ] Announce/record admin write freeze start time

## 2) Reconcile data into the Docker target
Treat the legacy catalog as source-of-truth unless a newer approved file exists elsewhere.
- [ ] Compare legacy `src/data/files.json` with the final intended production catalog
- [ ] Remove demo/test/placeholder rows from the final catalog
- [ ] Verify every published R2 key in the final catalog exists in the bucket
- [ ] Upload any missing objects to R2 before switch
- [ ] Copy the final catalog to `/opt/download-hub/data/files.json`
- [ ] Re-open the file on host and verify the expected slugs/objects are present

## 3) Verify the new stack in Portainer
In Portainer on `alpha`:
- [ ] Stack is the canonical Docker/Portainer deployment
- [ ] Container name is `download-hub-app`
- [ ] Restart policy is healthy / no crash loop
- [ ] Env values are present for `APP_BASE_URL`, `APP_HOSTNAME`, `DOWNLOAD_TOKEN_SECRET`, `ADMIN_*`, `TURNSTILE_*`, `HCAPTCHA_*`, `R2_*`
- [ ] Bind mount points to `/opt/download-hub/data`

Host checks on `alpha`:
- [ ] `curl http://127.0.0.1:3000/health`
- [ ] `ss -ltnp | grep 3000` shows localhost bind only
- [ ] App is not listening on public interfaces

## 4) Shut down the old runtime
Use only the method actually used on `alpha`.
- [ ] If old app runs in PM2, stop it from the legacy path
- [ ] If old app is managed by CloudPanel Node app mode, stop that app in CloudPanel
- [ ] If another supervisor is used, stop that exact service
- [ ] Verify the old process is no longer serving the production app

## 5) Switch CloudPanel reverse proxy
In CloudPanel for site `download.888vn.net`:
- [ ] Open the vhost/reverse-proxy config
- [ ] Replace the old upstream with `http://127.0.0.1:3000`
- [ ] Use `deploy/nginx-download-888vn.conf` as the base
- [ ] Keep TLS termination in CloudPanel/Nginx only
- [ ] Keep download buffering settings disabled as required by the shipped config
- [ ] Test and reload Nginx successfully

## 6) Smoke test immediately after switch
Run in this order.

Host/local checks:
- [ ] `curl http://127.0.0.1:3000/health`

Public checks:
- [ ] `curl -I https://download.888vn.net/health`
- [ ] Homepage loads
- [ ] One detail page loads
- [ ] Turnstile renders on the public download flow
- [ ] Turnstile verification succeeds

Admin checks:
- [ ] `/admin/login` loads
- [ ] hCaptcha renders
- [ ] Login succeeds with production username/password + hCaptcha
- [ ] Redirect lands on `/admin/r2`
- [ ] `GET /api/admin/r2/status` reports configured
- [ ] `GET /api/admin/r2/files` returns expected inventory
- [ ] Upload URL + upload confirm flow works
- [ ] Metadata edit works
- [ ] Publish/unpublish works

Download checks:
- [ ] One real published object downloads end-to-end
- [ ] An unpublished item is not publicly downloadable
- [ ] Expired token returns 403

## 7) Rollback triggers
Rollback immediately if any are true:
- [ ] Localhost health fails on the container
- [ ] External health fails after the Nginx switch
- [ ] Turnstile or hCaptcha production verification is broken
- [ ] Admin login works but `/admin/r2` inventory is broken
- [ ] Real published object download fails
- [ ] Wrong catalog/demo data is visible
- [ ] Portainer container is unstable or restarting repeatedly

## 8) Rollback steps on `alpha`
- [ ] Point CloudPanel back to the previous upstream/config
- [ ] Reload Nginx and confirm old path is active again
- [ ] Stop the Docker stack only if it is the source of the incident
- [ ] Restore legacy `.env` / `files.json` only if they were changed during recovery
- [ ] Restart the old runtime from `/home/download-888vn/htdocs/download.888vn.net`
- [ ] Re-test health, admin login, and one real download on the restored path
- [ ] Keep the Docker artifacts and logs for postmortem

## 9) Done criteria
Cutover is complete only when all are true:
- [ ] Production traffic reaches only `127.0.0.1:3000` via CloudPanel
- [ ] Legacy runtime stays off
- [ ] CloudPanel is reverse proxy/TLS edge only
- [ ] Public Turnstile flow passes
- [ ] Admin username/password + hCaptcha flow passes
- [ ] R2-backed upload/list/publish/download flows pass
- [ ] Backups and exported legacy config are retained until sign-off
