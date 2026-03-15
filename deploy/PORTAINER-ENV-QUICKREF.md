# Portainer Env Quick Reference

Use these as the minimum env vars in the Portainer stack UI.

## Core
- `NODE_ENV=production`
- `APP_BASE_URL=https://download.888vn.net`
- `APP_HOSTNAME=download.888vn.net`
- `PORT=3000`
- `TRUST_PROXY=loopback`
- `DOWNLOAD_TOKEN_SECRET=<long-random-secret>`

## Admin auth
- `ADMIN_USERNAME=<admin-user>`
- `ADMIN_PASSWORD=<strong-password>`
- `ADMIN_SESSION_SECRET=<long-random-secret>`

## Public captcha (Turnstile)
- `TURNSTILE_ENABLED=true`
- `TURNSTILE_SITE_KEY=...`
- `TURNSTILE_SECRET_KEY=...`
- `TURNSTILE_ACTION=download_gate`

## Admin captcha (hCaptcha)
- `HCAPTCHA_ENABLED=true`
- `HCAPTCHA_SITE_KEY=...`
- `HCAPTCHA_SECRET_KEY=...`
- `HCAPTCHA_EXPECTED_HOSTNAME=download.888vn.net`

## R2
- `R2_ENABLED=true`
- `R2_ACCOUNT_ID=...`
- `R2_ACCESS_KEY_ID=...`
- `R2_SECRET_ACCESS_KEY=...`
- `R2_BUCKET=download-hub-files`

## Optional / compatibility
- `ADMIN_BEARER_TOKEN=`
- `USE_X_ACCEL_REDIRECT=false`
- `X_ACCEL_INTERNAL_PREFIX=/protected-downloads`
