# Download Hub — Architecture

## Tổng quan

Download Hub là một web app Node.js/Express phục vụ hai mục đích:
1. **Public portal** — người dùng xem danh sách file, vượt captcha, nhận link tải có thời hạn
2. **Admin panel** — operator quản lý file catalog, upload lên R2 hoặc local storage

---

## Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js ≥ 20 (ESM modules) |
| HTTP framework | Express 5 |
| Template engine | EJS |
| Storage (remote) | Cloudflare R2 (S3-compatible, AWS SDK v3) |
| Storage (local) | Local filesystem (`./storage/files/`) |
| Captcha (public) | Cloudflare Turnstile |
| Captcha (admin) | hCaptcha |
| Auth (admin) | HMAC-signed session cookie + CSRF |
| Config | Environment variables (load via `--env-file=.env`) |

---

## Cấu trúc thư mục

```
download-hub/
├── src/
│   ├── server.js              # Entry point — Express app setup
│   ├── routes/
│   │   ├── site.js            # Public routes (/, /download/:slug, /files/:slug, /api/verify/:slug)
│   │   └── admin.js           # Admin routes (/admin/*, /api/admin/*)
│   ├── middleware/
│   │   ├── admin-auth.js      # Session issuance/validation, CSRF, credential check
│   │   ├── security.js        # Helmet CSP, rate-limit helpers, bearer token guard
│   │   ├── rate-limit.js      # Simple in-memory rate limiter
│   │   ├── logging.js         # Request logger
│   │   └── shutdown.js        # Graceful shutdown handler
│   └── lib/
│       ├── config.js          # Centralised config built from process.env
│       ├── file-store.js      # files.json CRUD + local disk scan
│       ├── r2-client.js       # Low-level R2 S3 client (list/delete/presign/stream)
│       ├── r2-storage.js      # Higher-level R2 helpers (upload buffer, presigned PUT, flags)
│       ├── storage-metadata.js # Resolve storage provider/key/path from catalog entry
│       ├── download-token.js  # Issue + verify short-lived HMAC download tokens
│       ├── captcha.js         # Turnstile (public) + hCaptcha (admin) verify
│       ├── i18n.js            # vi/en translation strings
│       └── utils.js           # HMAC token helpers, IP, locale, formatBytes
├── views/                     # EJS templates
│   ├── index.ejs              # File listing (public)
│   ├── download.ejs           # Download gate (captcha)
│   ├── admin-login.ejs        # Admin login form
│   ├── admin-r2.ejs           # Admin storage management UI
│   └── error.ejs
├── public/assets/             # Static JS/CSS
│   ├── site.css
│   ├── admin.js               # Admin panel JS
│   └── admin-r2.js            # R2/local file management JS
├── storage/files/             # Local file storage root
├── src/data/files.json        # File catalog (source of truth for metadata)
└── deploy/                    # Deployment configs (PM2, Nginx, R2 CORS)
```

---

## Luồng Public (Download)

```
Browser
  │
  ├─ GET /              → index.ejs (danh sách file published)
  │
  ├─ GET /download/:slug → download.ejs (Cloudflare Turnstile widget)
  │
  ├─ POST /api/verify/:slug
  │     └─ verifyTurnstileToken() → Cloudflare API
  │     └─ issueDownloadToken()   → HMAC signed token (TTL=120s)
  │     └─ trả về { downloadUrl: "/files/:slug?token=..." }
  │
  └─ GET /files/:slug?token=...
        └─ verifyDownloadToken() → check HMAC + expiry + slug match
        └─ streamDownload():
              ├─ R2 provider → GetObjectCommand → pipe stream to response
              └─ local provider → X-Accel-Redirect hoặc pipe file stream
```

---

## Luồng Admin

```
Browser
  │
  ├─ GET /admin/login → admin-login.ejs (hCaptcha widget)
  │
  ├─ POST /admin/login
  │     ├─ verifyHcaptchaToken() → hCaptcha API
  │     ├─ validateAdminCredentials() → timingSafeEqual(username:password)
  │     └─ issueAdminSession() → HMAC-signed cookie (TTL=3600s)
  │
  ├─ GET /admin/r2 [requireAdminSessionPage]
  │     └─ admin-r2.ejs → admin-r2.js (SPA-like)
  │
  └─ /api/admin/* [requireAdminSession + CSRF check]
        ├─ GET    /r2/status          → R2 config health
        ├─ GET    /r2/files           → merge R2 objects với catalog
        ├─ POST   /r2/sync            → sync R2 objects vào files.json
        ├─ DELETE /r2/files/:slug     → xóa R2 + catalog
        ├─ PATCH  /r2/files/:slug/publish   → toggle published
        ├─ PATCH  /r2/files/:slug/metadata  → update title/summary/version
        ├─ POST   /r2/upload-url      → presigned PUT URL (browser→R2 direct)
        ├─ POST   /r2/upload-direct   → server-proxy upload (bypass CORS)
        ├─ POST   /r2/upload-confirm  → đăng ký file mới vào catalog
        ├─ GET    /local/files        → list local storage + catalog
        ├─ POST   /local/upload       → upload binary lên local disk
        └─ POST   /local/confirm      → xác nhận file + thêm vào catalog
```

---

## Storage Architecture

Hệ thống hỗ trợ hai storage provider, có thể dùng song song:

```
┌─────────────────────────────────────────────────────┐
│                    files.json                       │
│  (catalog — metadata, slug, title, storageProvider) │
└──────────────┬──────────────────────────┬───────────┘
               │                          │
        provider = 'r2'           provider = 'local'
               │                          │
   ┌───────────▼──────────┐    ┌──────────▼──────────┐
   │  Cloudflare R2       │    │  Local Filesystem   │
   │  bucket: dl888       │    │  ./storage/files/   │
   │  (S3-compatible API) │    │  (bind mount)       │
   └──────────────────────┘    └─────────────────────┘
```

**R2 upload flows:**
- **Presigned PUT** (`upload-url` → browser PUT trực tiếp lên R2) — nhanh, không qua server
- **Server proxy** (`upload-direct`) — fallback khi CORS block presigned URL

**Download flows:**
- R2: Server gọi `GetObjectCommand` rồi pipe stream về browser (không expose R2 URL)
- Local: Pipe file stream trực tiếp, hoặc `X-Accel-Redirect` nếu dùng Nginx

---

## Auth & Security

### Admin Session
- Cookie: `dl888_admin_sess`, HMAC-signed (SHA-256), chứa `{ role: 'admin', exp: timestamp }`
- CSRF: mọi POST/PATCH/DELETE cần header `X-CSRF-Token` hoặc body field `_csrf` (= 16 ký tự cuối session token)
- Legacy: `ADMIN_BEARER_TOKEN` vẫn hoạt động nhưng bị disable trong production

### Download Token
- Query param `token` trên `/files/:slug`, HMAC-signed, TTL mặc định 120s
- Payload gồm `{ slug, exp, ip }` — validate IP để chống share link

### Rate Limiting
- In-memory per-IP, window 300s, max 20 attempts (configurable)
- Áp dụng cho `/api/verify/:slug` (public captcha) và `/admin/login`

### Headers (Helmet)
- CSP với nonce cho inline scripts
- HSTS, X-Frame-Options, X-Content-Type-Options

---

## Config (Environment Variables)

| Variable | Mô tả | Default |
|----------|-------|---------|
| `NODE_ENV` | `production` / `development` | `development` |
| `PORT` | HTTP port | `3000` |
| `ADMIN_USERNAME` | Admin login username | _(required)_ |
| `ADMIN_PASSWORD` | Admin login password | _(required)_ |
| `ADMIN_SESSION_SECRET` | HMAC key cho session cookie | _(required)_ |
| `ADMIN_SESSION_TTL_SECONDS` | Session timeout | `3600` |
| `ADMIN_COOKIE_NAME` | Tên session cookie | `download_hub_admin_sess` |
| `DOWNLOAD_TOKEN_SECRET` | HMAC key cho download token | _(required)_ |
| `DOWNLOAD_TOKEN_TTL_SECONDS` | Token TTL | `120` |
| `HCAPTCHA_ENABLED` | Bật hCaptcha cho admin login | `false` |
| `HCAPTCHA_SITE_KEY` | hCaptcha site key | |
| `HCAPTCHA_SECRET_KEY` | hCaptcha secret key | |
| `TURNSTILE_ENABLED` | Bật Turnstile cho public download | `true` |
| `TURNSTILE_SITE_KEY` | Cloudflare Turnstile site key | |
| `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile secret key | |
| `R2_ENABLED` | Bật Cloudflare R2 storage | `false` |
| `R2_ACCOUNT_ID` | Cloudflare account ID | |
| `R2_ACCESS_KEY_ID` | R2 access key | |
| `R2_SECRET_ACCESS_KEY` | R2 secret key | |
| `R2_BUCKET` | R2 bucket name | |
| `FILES_INDEX_PATH` | Đường dẫn files.json | `./src/data/files.json` |
| `FILES_STORAGE_PATH` | Thư mục local storage | `./storage/files` |

> **Quan trọng**: App đọc `process.env` trực tiếp, không dùng dotenv.
> Chạy local: `node --env-file=.env src/server.js` (hoặc `npm run dev`).
> Chạy production: PM2 đọc env trực tiếp từ `.env` qua `--env-file` flag trong `deploy/ecosystem.config.cjs`, hoặc `pm2 start ... --update-env` sau khi sửa file.

---

## Deployment

```
Internet → Cloudflare (CDN/WAF/Turnstile)
                │
           Nginx (TLS termination, reverse proxy)
                │ X-Accel-Redirect (optional local download)
           Node.js app (PM2, 127.0.0.1:3000)
                │
          ┌─────┴─────┐
         R2          Local disk
     (Cloudflare)  (filesystem)
```

- PM2 ecosystem: `deploy/ecosystem.config.cjs`
- Nginx vhost: `deploy/nginx-download-hub.conf` (or `deploy/nginx-download-888vn.conf` for the alpha host)

---

## File Catalog (files.json schema)

```json
{
  "id": "win-toolkit-v1-1234567890",
  "slug": "win-toolkit-v1",
  "title": { "vi": "Bộ công cụ Windows", "en": "Windows Toolkit" },
  "summary": { "vi": "...", "en": "..." },
  "version": "1.0.0",
  "platform": "Windows",
  "language": ["vi", "en"],
  "sizeBytes": 1048576,
  "checksumSha256": "abc123...",
  "mimeType": "application/zip",
  "storage": {
    "provider": "r2",
    "objectKey": "windows/win-toolkit-v1.zip",
    "downloadName": "win-toolkit-v1.zip"
  },
  "published": true,
  "featured": false,
  "tags": [],
  "updatedAt": "2025-01-01T00:00:00.000Z"
}
```
