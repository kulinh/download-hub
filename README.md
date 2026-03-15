# download-888vn

> **⚠️ Demo Scaffold** — Repo này là bộ khung (demo scaffold) sẵn sàng deploy.
> Catalog file (`src/data/files.json`) chứa:
> - 1 mục demo **có file thật** (5-byte dummy, `"demo": true`) để test luồng tải end-to-end.
> - 1 mục placeholder **chưa có file** (`published: false`) minh họa cách thêm sản phẩm mới.
>
> Xem mục **[Publish file đầu tiên](#publish-file-đầu-tiên)** để thay thế bằng file production thật.

## Stack

- Node.js 20+
- Express 5 + EJS
- Helmet + per-request CSP nonce cho security headers
- Cloudflare Turnstile ưu tiên, hCaptcha fallback
- File thật lưu local và upload qua SFTP vào `storage/files/`
- Không cần DB, không có admin panel

## Tính năng

- Trang public liệt kê file tải song ngữ VI/EN
- Mỗi file có trang chi tiết riêng
- Chỉ cấp link tải sau khi captcha pass server-side
- Link tải ngắn hạn, ký HMAC, bind theo IP + User-Agent (HMAC-SHA-256) để chặn hotlink
- Hỗ trợ 2 mode tải file:
  - `sendFile` trực tiếp từ Node
  - `X-Accel-Redirect` qua Nginx internal location cho CloudPanel/Nginx
- Rate limiting in-process với GC định kỳ (không leak memory)
- Optional request logging via `LOG_REQUESTS=true`
- Health check endpoint `/health`
- Admin reload endpoint `POST /api/admin/reload` (bảo vệ bằng bearer token, optional)
- `robots.txt` và `.well-known/security.txt` tự serve từ Node
- XSS-safe: result area sau verify dùng DOM API, không `innerHTML`

## Cấu trúc

```
├── src/
│   ├── data/files.json         — metadata index của file download
│   ├── lib/
│   │   ├── captcha.js          — Turnstile/hCaptcha verify
│   │   ├── config.js           — tất cả env vars
│   │   ├── download-token.js   — HMAC token issue/verify + stream
│   │   ├── file-store.js       — đọc index, resolve path (chặn traversal)
│   │   ├── i18n.js             — VI/EN translations
│   │   └── utils.js            — helpers
│   ├── middleware/
│   │   ├── rate-limit.js       — in-process rate limiter + periodic GC
│   │   └── security.js         — helmet/CSP nonce + content-type guard
│   ├── routes/site.js          — tất cả routes
│   └── server.js               — entry point
├── scripts/
│   └── check-startup.mjs       — smoke-test: import check + config validation (npm run check)
├── views/
│   ├── index.ejs
│   ├── download.ejs
│   └── error.ejs
├── public/
│   ├── assets/site.css
│   ├── robots.txt
│   └── .well-known/security.txt
├── storage/files/              — nơi chứa file tải thật (upload qua SFTP)
└── deploy/
    ├── nginx-download-888vn.conf
    └── ecosystem.config.cjs    — PM2 config
```

## Chạy local

```bash
cp .env.example .env
npm install
npm run check   # smoke-test config + modules trước khi start
npm run dev
```

Mở `http://localhost:3000`.

## Cấu hình captcha

### Ưu tiên: Cloudflare Turnstile

```env
TURNSTILE_ENABLED=true
TURNSTILE_SITE_KEY=your-site-key
TURNSTILE_SECRET_KEY=your-secret-key
TURNSTILE_ACTION=download_gate
```

Server verify qua `POST https://challenges.cloudflare.com/turnstile/v0/siteverify`, kiểm tra `hostname` và `action`.

### Fallback: hCaptcha

```env
TURNSTILE_ENABLED=false
HCAPTCHA_ENABLED=true
HCAPTCHA_SITE_KEY=your-site-key
HCAPTCHA_SECRET_KEY=your-secret-key
HCAPTCHA_EXPECTED_HOSTNAME=download.888vn.net
```

Server verify qua `POST https://api.hcaptcha.com/siteverify` (form-urlencoded), kiểm tra `hostname`.

## Hotlink protection design

1. User mở trang chi tiết file → captcha widget render.
2. Form submit đến `POST /api/verify/:slug`.
3. Server verify token với Turnstile hoặc hCaptcha.
4. Nếu pass → issue token HMAC ngắn hạn (`DOWNLOAD_TOKEN_TTL_SECONDS`, mặc định 120s).
5. Token chứa `slug`, `exp`, `ipHash` (SHA-256 của IP), `uaHash` (SHA-256 của UA).
6. Client redirect đến `GET /files/:slug?token=...`.
7. Server kiểm tra chữ ký, hết hạn, IP, UA.
8. Nếu `USE_X_ACCEL_REDIRECT=true` → Node authorize rồi giao Nginx internal serve file.

## Deploy trên CloudPanel

### 1. Tạo Node.js site trong CloudPanel

- Domain: `download.888vn.net`
- Webroot (Node app): `/home/cloudpanel/htdocs/download-888vn/app`

### 2. Upload source

```bash
# trên server
mkdir -p /home/cloudpanel/htdocs/download-888vn/app
# rsync hoặc git clone source vào đó
```

### 3. Upload file tải qua SFTP

```
/home/cloudpanel/htdocs/download-888vn/storage/files/
```

> **Lưu ý về đường dẫn**: `app/` chứa source code; `storage/files/` là sibling directory bên ngoài app.
> Trong `.env` production, set:
> ```env
> FILES_STORAGE_PATH=/home/cloudpanel/htdocs/download-888vn/storage/files
> ```
> Đường dẫn tuyệt đối tránh nhầm lẫn relative path khi PM2 start từ `cwd` của app.

### 4. Cấu hình .env

```bash
cp .env.example .env
# sửa DOWNLOAD_TOKEN_SECRET, TURNSTILE_*, APP_BASE_URL...
```

### 5. Cài dependencies

```bash
npm install --omit=dev
```

### 6. Start app

CloudPanel UI → Node.js → Start, hoặc dùng PM2:

```bash
pm2 start deploy/ecosystem.config.cjs --env production
pm2 save
pm2 startup
```

> **PM2 ecosystem notes**: `deploy/ecosystem.config.cjs` dùng interpreter `node` plain (không có
> `interpreter_args`). App là native ESM (`"type":"module"`) — không cần flag
> `--experimental-vm-modules` hay `--input-type`. PM2 `cwd` trỏ vào thư mục app
> (`/home/cloudpanel/htdocs/download-888vn/app`), còn `FILES_STORAGE_PATH` nên set thành
> absolute path trong `.env` (xem bước 4).

### 7. Nginx (optional — nếu cần X-Accel-Redirect)

Import `deploy/nginx-download-888vn.conf` vào CloudPanel vhost custom config.
Đặt `USE_X_ACCEL_REDIRECT=true` trong `.env`.

> **Lưu ý**: CloudPanel quản lý SSL (Let's Encrypt) tự động. Conf file chứa block redirect HTTP→HTTPS nhưng cert paths cần khớp với CloudPanel.

## Admin API

### Reload files index (không cần restart)

```bash
curl -X POST https://download.888vn.net/api/admin/reload \
  -H "Authorization: Bearer YOUR_ADMIN_BEARER_TOKEN"
```

Set `ADMIN_BEARER_TOKEN` trong `.env`. Để trống = endpoint bị disable (trả 403).

## Health check

```
GET /health
→ {"ok":true,"uptime":123}
```

## Publish file đầu tiên

Repo check-in ở trạng thái **demo scaffold**:
- `win-toolkit-v1` — có 5-byte dummy file (`storage/files/windows/win-toolkit-v1.zip`), `"demo": true`, đã `published: true` để test luồng tải end-to-end.
- `android-pack-v2` — placeholder, chưa có file, `"published": false`.

Để đưa lên production với file thật:

1. **Upload file thật** qua SFTP vào `FILES_STORAGE_PATH/<subfolder>/` trên server.
   - CloudPanel example: `/home/cloudpanel/htdocs/download-888vn/storage/files/windows/win-toolkit-v1.zip`
2. **Tính SHA-256 thật** của file vừa upload:
   ```bash
   sha256sum /path/to/win-toolkit-v1.zip
   ```
3. **Cập nhật `src/data/files.json`** cho mục tương ứng:
   - Đặt `"published": true`
   - Điền `sizeBytes` (bytes thật của file)
   - Điền `checksumSha256` (kết quả sha256sum)
   - Xoá tag `"sample"` và `"demo"` nếu muốn
4. **Reload index** (không cần restart app):
   ```bash
   curl -X POST https://download.888vn.net/api/admin/reload \
     -H "Authorization: Bearer YOUR_ADMIN_BEARER_TOKEN"
   ```

> **Lưu ý quan trọng về `FILES_STORAGE_PATH`**: Trong `.env.example`, giá trị mặc định là
> `./storage/files` (relative). Khi deploy CloudPanel với PM2, `cwd` của app là
> `/home/cloudpanel/htdocs/download-888vn/app`, và `storage/` là sibling directory ngoài `app/`.
> Vì vậy trong `.env` production **phải dùng absolute path**:
> ```env
> FILES_STORAGE_PATH=/home/cloudpanel/htdocs/download-888vn/storage/files
> ```

## Cập nhật file download

1. Upload file mới qua SFTP vào `storage/files/<folder>/`.
2. Tính SHA-256 thật.
3. Sửa `src/data/files.json`.
4. Reload: `curl -X POST /api/admin/reload -H "Authorization: Bearer TOKEN"` (hoặc restart app).

## Ghi chú bảo mật

- Anti-hotlink mức thực dụng cho traffic thấp (<50 downloads/tháng). Không phải DRM.
- IP/UA binding dùng SHA-256 — khác hẳn base64 encoding, an toàn hơn.
- Path traversal ngăn bằng normalized-base check (trailing separator).
- Rate limiter có GC định kỳ để tránh memory leak dài hạn.
- CSP dùng per-request nonce cho script inline, không dùng `unsafe-eval`.
- Nếu muốn chặt hơn: thêm nonce 1 lần + Redis, nhưng với traffic thấp thì không cần.
- Đổi `DOWNLOAD_TOKEN_SECRET` thành secret dài, random, riêng production.

## Troubleshooting / Runbook

### 1) `Captcha verification failed`

Kiểm tra theo thứ tự:
- `.env`: đúng cặp key/secret cho **đúng provider** đang bật (`TURNSTILE_*` hoặc `HCAPTCHA_*`).
- Hostname khớp domain production:
  - Turnstile: `APP_HOSTNAME=download.888vn.net`
  - hCaptcha: `HCAPTCHA_EXPECTED_HOSTNAME=download.888vn.net`
- Turnstile action khớp: `TURNSTILE_ACTION=download_gate`.
- Reverse proxy có pass IP/host chuẩn (`Host`, `X-Forwarded-For`, `X-Forwarded-Proto`).
- Kiểm tra app log để xem `error-codes` từ provider.

Sau khi sửa:
```bash
pm2 restart download-888vn
pm2 logs download-888vn --lines 100
```

### 2) Download fail khi bật `X-Accel-Redirect`

Triệu chứng thường gặp: verify captcha pass nhưng tải file trả 404/403/zero-byte.

Kiểm tra:
- `.env`: `USE_X_ACCEL_REDIRECT=true`
- `.env`: `X_ACCEL_INTERNAL_PREFIX=/protected-downloads`
- Nginx `location /protected-downloads/` phải dùng **cùng prefix**.
- Nginx `alias` phải trỏ đúng thư mục thật:
  `/home/cloudpanel/htdocs/download-888vn/storage/files/`
- Sau khi sửa nginx:
  ```bash
  nginx -t && systemctl reload nginx
  ```
- Nếu cần cô lập lỗi, tắt offload tạm thời để test Node serve trực tiếp:
  ```env
  USE_X_ACCEL_REDIRECT=false
  ```

### 3) `Download link is invalid or expired`

Nguyên nhân chính:
- Token hết hạn (`DOWNLOAD_TOKEN_TTL_SECONDS`, mặc định 120s).
- IP/UA thay đổi giữa lúc verify captcha và lúc tải file.
- Người dùng copy link sang thiết bị/trình duyệt khác.

Cách xử lý:
- Yêu cầu user mở lại trang chi tiết và verify captcha lại.
- Không chia sẻ link tải giữa browser/app khác.
- Nếu đứng sau proxy/CDN, giữ `TRUST_PROXY=loopback` hoặc cấu hình phù hợp để app nhận đúng client IP.

### 4) `ENOENT` / missing storage path / file không tồn tại

Kiểm tra:
- `FILES_STORAGE_PATH` production phải là **absolute path**:
  ```env
  FILES_STORAGE_PATH=/home/cloudpanel/htdocs/download-888vn/storage/files
  ```
- File thật đã upload đúng subfolder như trong `src/data/files.json`.
- Tên file phân biệt hoa thường trên Linux.
- Quyền đọc của user chạy Node/PM2 đủ truy cập thư mục `storage/files/`.

Sau khi upload file mới hoặc sửa `files.json`:
```bash
curl -X POST https://download.888vn.net/api/admin/reload \
  -H "Authorization: Bearer YOUR_ADMIN_BEARER_TOKEN"
```

### 5) PM2 logs / app không start đúng

Lệnh hữu ích:
```bash
pm2 status
pm2 show download-888vn
pm2 logs download-888vn --lines 200
```

Log file theo ecosystem mặc định:
- stdout: `/var/log/pm2/download-888vn.out.log`
- stderr: `/var/log/pm2/download-888vn.err.log`

Nếu app crash ngay khi boot:
- Chạy `npm run check` để validate config/import.
- Kiểm tra `.env` thiếu secret/captcha provider trong production.
- Xác nhận `cwd` PM2 là `/home/cloudpanel/htdocs/download-888vn/app`.

## Ops / Maintenance

### Rotate secrets

Nên rotate khi lộ secret, đổi nhân sự, hoặc theo chu kỳ nội bộ:
- `DOWNLOAD_TOKEN_SECRET`
- `ADMIN_BEARER_TOKEN`
- `TURNSTILE_SECRET_KEY` hoặc `HCAPTCHA_SECRET_KEY`

Quy trình tối thiểu:
1. Tạo secret mới đủ dài và random.
2. Cập nhật `.env` trên server.
3. Restart app:
   ```bash
   pm2 restart download-888vn
   ```
4. Re-test `/health`, verify captcha, và 1 lượt tải file.

> Lưu ý: rotate `DOWNLOAD_TOKEN_SECRET` sẽ làm **toàn bộ token tải đang phát hành hết hiệu lực ngay**.

### Backup / restore

Cần backup tối thiểu:
- `.env`
- `src/data/files.json`
- toàn bộ `storage/files/`
- custom Nginx vhost config (nếu có chỉnh tay)

Backup ví dụ:
```bash
tar -czf download-888vn-backup-$(date +%F).tar.gz \
  /home/cloudpanel/htdocs/download-888vn/app/.env \
  /home/cloudpanel/htdocs/download-888vn/app/src/data/files.json \
  /home/cloudpanel/htdocs/download-888vn/storage/files
```

Restore:
1. Giải nén lại đúng path.
2. Kiểm tra quyền file/thư mục.
3. `pm2 restart download-888vn`
4. Gọi `/api/admin/reload` nếu chỉ restore lại metadata/file.

### Release / update procedure

1. Backup `.env`, `files.json`, `storage/files/`.
2. Deploy code mới vào `app/`.
3. Chạy:
   ```bash
   npm install --omit=dev
   npm run check
   ```
4. Restart app:
   ```bash
   pm2 restart download-888vn
   ```
5. Nếu có đổi Nginx config:
   ```bash
   nginx -t && systemctl reload nginx
   ```
6. Chạy checklist validation bên dưới trước khi xem là xong.

## Post-install validation checklist

Sau khi cài mới hoặc update production, kiểm tra nhanh:
- [ ] `GET /health` trả `200` và `{"ok":true,...}`
- [ ] Trang chủ mở được qua HTTPS, không lỗi template/CSP rõ ràng trên browser console
- [ ] Trang chi tiết file render captcha đúng provider đang cấu hình
- [ ] Verify captcha thành công và nhận `downloadUrl`
- [ ] Tải được 1 file thật end-to-end
- [ ] Mở lại `downloadUrl` sau khi hết TTL hoặc ở browser khác phải bị chặn `403`
- [ ] Nếu bật `USE_X_ACCEL_REDIRECT=true`, tải vẫn hoạt động qua Nginx offload
- [ ] `POST /api/admin/reload` hoạt động với bearer token đúng và bị chặn khi sai/thiếu token
- [ ] `robots.txt` và `/.well-known/security.txt` truy cập được
- [ ] `pm2 status` không có restart loop; xem `pm2 logs download-888vn --lines 100` không có lỗi boot/runtime bất thường
