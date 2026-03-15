# Deployment Guide

This project is designed to be easily deployed on **CloudPanel** (or any standard Linux VPS with Nginx and PM2).

## Prerequisites
- Node.js 20+
- PM2 (global install)
- Nginx

## Deploying on CloudPanel

### 1. Prepare Environment
- Create a **Node.js** site in CloudPanel with domain `download.888vn.net`.
- Note the webroot, typically `/home/cloudpanel/htdocs/download-888vn`.

### 2. Setup Directory Structure
We separate the application code (`app/`) from the file storage (`storage/`) to ensure downloaded files are kept safe across deployments.

```bash
mkdir -p /home/cloudpanel/htdocs/download-888vn/app
mkdir -p /home/cloudpanel/htdocs/download-888vn/storage/files
```

### 3. Deploy Application Code
Upload the repository contents to the `app/` directory.

```bash
cd /home/cloudpanel/htdocs/download-888vn/app
npm install --omit=dev
cp .env.example .env
```

### 4. Configure Environment Variables (`.env`)
Edit `.env` and configure essential variables:

```env
NODE_ENV=production
APP_BASE_URL=https://download.888vn.net

# Security Keys (CHANGE THESE)
DOWNLOAD_TOKEN_SECRET=your_long_random_secret_string_here
ADMIN_BEARER_TOKEN=your_admin_secret_token_here

# Storage Path MUST be absolute in production
FILES_STORAGE_PATH=/home/cloudpanel/htdocs/download-888vn/storage/files

# Captcha Setup (Choose Turnstile or hCaptcha)
TURNSTILE_ENABLED=true
TURNSTILE_SITE_KEY=your_site_key
TURNSTILE_SECRET_KEY=your_secret_key

# Enable Nginx X-Accel-Redirect (Highly recommended for production)
USE_X_ACCEL_REDIRECT=true
```

### 5. Start with PM2
Use the provided PM2 ecosystem file:

```bash
pm2 start deploy/ecosystem.config.cjs --env production
pm2 save
```

### 6. Configure Nginx
Copy the contents of `deploy/nginx-download-888vn.conf` into the CloudPanel Vhost configuration for your site. This enables `X-Accel-Redirect` for efficient file serving and adds security headers.

### 7. Upload and Publish Files
1. Upload your files via SFTP to `/home/cloudpanel/htdocs/download-888vn/storage/files/<category>/`.
2. Calculate the SHA-256 hash: `sha256sum /path/to/file.zip`.
3. Update `/home/cloudpanel/htdocs/download-888vn/app/src/data/files.json` with file details, size, and checksum.
4. Reload the app's cache (no restart needed):
   ```bash
   curl -X POST https://download.888vn.net/api/admin/reload -H "Authorization: Bearer YOUR_ADMIN_BEARER_TOKEN"
   ```

## Minimal Operations Notes

### Post-install validation
- `curl -I https://download.888vn.net/health`
- Open homepage and one file detail page over HTTPS
- Complete captcha once and confirm download starts
- Retry expired/shared link and confirm it is rejected with 403
- Test `POST /api/admin/reload` with valid bearer token
- Check `pm2 status` and `pm2 logs download-888vn --lines 100`

### Common production failures

**Captcha verify error**
- Re-check active provider keys in `.env`
- Confirm hostname/action match production domain
- Restart PM2 after secret changes

**X-Accel-Redirect mismatch**
- `USE_X_ACCEL_REDIRECT=true`
- `X_ACCEL_INTERNAL_PREFIX` must match nginx internal `location`
- nginx `alias` must point to `/home/cloudpanel/htdocs/download-888vn/storage/files/`
- Apply `nginx -t && systemctl reload nginx`

**Invalid/expired token or IP-UA mismatch**
- Token default TTL is short (120s)
- User must download from same browser/device after captcha verify
- Reverse proxy must forward real client IP correctly

**Missing storage path / file not found**
- `FILES_STORAGE_PATH` should be absolute in production
- Confirm file exists exactly as referenced in `files.json`
- Reload app index after metadata/file changes

**PM2 diagnostics**
- `pm2 show download-888vn`
- stdout: `/var/log/pm2/download-888vn.out.log`
- stderr: `/var/log/pm2/download-888vn.err.log`

### Maintenance

**Secret rotation**
- Rotate `DOWNLOAD_TOKEN_SECRET`, `ADMIN_BEARER_TOKEN`, captcha secret keys in `.env`
- `pm2 restart download-888vn`
- Re-test `/health`, captcha verify, and one download

**Backup / restore**
- Backup `.env`, `src/data/files.json`, and `storage/files/`
- Restore to the same paths, then restart PM2
- Call `/api/admin/reload` if only file metadata/storage changed

**Release / update**
1. Backup runtime files
2. Deploy new code into `app/`
3. Run `npm install --omit=dev && npm run check`
4. `pm2 restart download-888vn`
5. Reload nginx if vhost config changed
