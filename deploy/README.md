# Deployment Guide

This project is designed to be easily deployed on **CloudPanel** (or any standard Linux VPS with Nginx and PM2).

## Prerequisites
- Node.js 20+
- PM2 (global install)
- Nginx

## Auth architecture summary

| Flow | Captcha | Auth |
|------|---------|------|
| Public download | Cloudflare Turnstile | None (download tokens) |
| Admin panel login | hCaptcha | Username + password + hCaptcha → signed session cookie |
| Admin API (all /api/admin/*) | — | Admin session cookie (required) |

> **Legacy**: `ADMIN_BEARER_TOKEN` is a backward-compat mechanism for CI/CD
> pipelines and old automation scripts. New deployments should use session
> cookie auth exclusively. Leave `ADMIN_BEARER_TOKEN` empty in `.env` unless
> you have an existing CI/CD pipeline that depends on it.

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
APP_HOSTNAME=download.888vn.net

# Security Keys (CHANGE THESE)
DOWNLOAD_TOKEN_SECRET=your_long_random_secret_string_here
ADMIN_SESSION_SECRET=your_long_random_admin_session_secret

# Admin hard auth (REQUIRED in production)
ADMIN_USERNAME=your_admin_username
ADMIN_PASSWORD=your_strong_admin_password

# Storage Path MUST be absolute in production
FILES_STORAGE_PATH=/home/cloudpanel/htdocs/download-888vn/storage/files

# Public download captcha: Cloudflare Turnstile (REQUIRED)
TURNSTILE_ENABLED=true
TURNSTILE_SITE_KEY=your_site_key
TURNSTILE_SECRET_KEY=your_secret_key

# Admin panel captcha: hCaptcha (REQUIRED in production)
HCAPTCHA_ENABLED=true
HCAPTCHA_SITE_KEY=your_hcaptcha_site_key
HCAPTCHA_SECRET_KEY=your_hcaptcha_secret_key
HCAPTCHA_EXPECTED_HOSTNAME=download.888vn.net

# Cloudflare R2 (REQUIRED in production)
R2_ENABLED=true
R2_ACCOUNT_ID=your_account_id
R2_ACCESS_KEY_ID=your_access_key
R2_SECRET_ACCESS_KEY=your_secret_key
R2_BUCKET=your_bucket_name

# Enable Nginx X-Accel-Redirect (local disk mode only, not needed with R2)
USE_X_ACCEL_REDIRECT=false

# Legacy bearer token for CI/CD pipelines (leave blank for new deployments)
# ADMIN_BEARER_TOKEN=
```

### 5. Start with PM2
Use the provided PM2 ecosystem file:

```bash
pm2 start deploy/ecosystem.config.cjs --env production
pm2 save
```

### 6. Configure Nginx
Copy the contents of `deploy/nginx-download-888vn.conf` into the CloudPanel Vhost configuration for your site. This enables `X-Accel-Redirect` for efficient file serving and adds security headers.

### 7. Manage Files via Admin Panel
1. Log in at `https://download.888vn.net/admin/login` with your credentials and hCaptcha.
2. Use the **R2 File Management** interface to upload, sync, and publish files.
3. Files uploaded to R2 are delivered via presigned URLs after Turnstile verification.

## Minimal Operations Notes

### Post-install validation
- `curl -I https://download.888vn.net/health`
- Open homepage and one file detail page over HTTPS
- Log in to admin panel at `/admin/login`
- Complete hCaptcha + credentials and confirm redirect to `/admin/r2`
- Complete public download Turnstile and confirm download starts
- Retry expired/shared link and confirm it is rejected with 403
- Check `pm2 status` and `pm2 logs download-888vn --lines 100`

### Common production failures

**hCaptcha fails on admin login**
- Confirm `HCAPTCHA_ENABLED=true` and keys are correct
- `HCAPTCHA_EXPECTED_HOSTNAME` must match production domain
- Restart PM2 after env changes

**Turnstile fails on public download**
- Re-check Turnstile keys in `.env`
- Confirm hostname/action match production domain
- Restart PM2 after secret changes

**Admin login redirects to login (session not established)**
- Confirm `ADMIN_SESSION_SECRET` is set and non-placeholder
- Confirm `ADMIN_COOKIE_NAME` matches between restarts
- Check browser allows cookies from the domain

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
- Rotate `DOWNLOAD_TOKEN_SECRET`, `ADMIN_SESSION_SECRET`, captcha secret keys in `.env`
- `pm2 restart download-888vn`
- Re-test admin login, captcha verify, and one download

**Backup / restore**
- Backup `.env`, `src/data/files.json`, and `storage/files/`
- Restore to the same paths, then restart PM2

**Release / update**
1. Backup runtime files
2. Deploy new code into `app/`
3. Run `npm install --omit=dev && npm run check`
4. `pm2 restart download-888vn`
5. Reload nginx if vhost config changed
