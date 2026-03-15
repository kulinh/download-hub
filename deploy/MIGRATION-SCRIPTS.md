# Migration Helper Scripts

Mục tiêu: giảm thao tác tay khi chuyển từ local disk + `files.json` sang Docker + Cloudflare R2.

## 1) Export catalog + scan local storage

```bash
node scripts/migrate-export.mjs --out ./work/migration-audit
```

Artifacts tạo ra:
- `catalog-export.json` — bản export raw của `files.json`
- `disk-scan.json` — toàn bộ file thực tế dưới `storage/files`
- `migration-report.json` — đối soát catalog vs disk
- `r2-upload-manifest.json` — manifest sẵn cho upload lên R2
- `catalog-r2-preview.json` — preview catalog đã gắn `r2.key`

Mặc định quy tắc mapping là giữ nguyên relative path:
- `storage/files/windows/foo.zip` → `windows/foo.zip`
- `storage/files/android/bar.apk` → `android/bar.apk`

Report sẽ highlight:
- file có trên disk nhưng chưa có trong catalog
- catalog entry trỏ tới file không còn trên disk
- demo entry đang publish
- entry cần refresh size/checksum/mimeType

## 2) Dry-run upload plan

```bash
node scripts/migrate-upload-r2.mjs \
  --manifest ./work/migration-audit/r2-upload-manifest.json
```

Mặc định script **không upload thật**. Nó chỉ in preview những gì sẽ đẩy lên bucket.

## 3) Upload thật lên R2

```bash
R2_ENABLED=true \
R2_ACCOUNT_ID=... \
R2_ACCESS_KEY_ID=... \
R2_SECRET_ACCESS_KEY=... \
R2_BUCKET=download-hub-files \
node scripts/migrate-upload-r2.mjs \
  --manifest ./work/migration-audit/r2-upload-manifest.json \
  --execute \
  --results ./work/migration-audit/r2-upload-results.json
```

### Safety defaults
- Không upload thật nếu thiếu `--execute`
- Mặc định **skip object đã tồn tại** trên R2
- Upload tuần tự để dễ theo dõi và giảm burst
- Có thể giới hạn batch nhỏ:

```bash
node scripts/migrate-upload-r2.mjs \
  --manifest ./work/migration-audit/r2-upload-manifest.json \
  --execute \
  --limit 20
```

## 4) Khuyến nghị operator

1. Chạy export trước
2. Mở `migration-report.json` kiểm tra `publishRiskEntries` + `missingOnDisk`
3. Upload batch nhỏ để spot-check
4. Chỉ sau khi xác nhận object count / total size / sample download đúng thì mới dùng `catalog-r2-preview.json` để reconcile metadata

## 5) Lưu ý

- Script này không tự overwrite production `src/data/files.json`
- `catalog-r2-preview.json` chỉ là preview/operator artifact
- Nếu repo còn demo rows, giữ chúng ở trạng thái draft hoặc remove khỏi production catalog trước cutover
