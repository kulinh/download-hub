# Alpha Migration Commands

## Assumptions
- Legacy live path: `/home/download-888vn/htdocs/download.888vn.net`
- Legacy app path: `/home/download-888vn/htdocs/download.888vn.net/app`
- Legacy storage path: `/home/download-888vn/htdocs/download.888vn.net/storage/files`
- New canonical Docker/R2 app target example: `/opt/download-hub/app`
- New persistent metadata example: `/opt/download-hub/data/files.json`

Adjust paths if your actual layout differs.

## 1) Export current catalog + disk scan from legacy app
```bash
cd /home/download-888vn/htdocs/download.888vn.net/app
node scripts/migrate-export.mjs \
  --catalog ./src/data/files.json \
  --storage /home/download-888vn/htdocs/download.888vn.net/storage/files \
  --out /home/download-888vn/htdocs/download.888vn.net/migration-audit
```

Artifacts created:
- `catalog-export.json`
- `disk-scan.json`
- `migration-report.json`
- `r2-upload-manifest.json`
- `catalog-r2-preview.json`

## 2) Review migration report
```bash
cd /home/download-888vn/htdocs/download.888vn.net/migration-audit
ls -la
cat migration-report.json
```

## 3) Dry-run R2 upload plan
```bash
cd /home/download-888vn/htdocs/download.888vn.net/app
R2_ENABLED=true \
R2_ACCOUNT_ID=YOUR_ACCOUNT_ID \
R2_ACCESS_KEY_ID=YOUR_ACCESS_KEY \
R2_SECRET_ACCESS_KEY=YOUR_SECRET_KEY \
R2_BUCKET=YOUR_BUCKET \
node scripts/migrate-upload-r2.mjs \
  --manifest /home/download-888vn/htdocs/download.888vn.net/migration-audit/r2-upload-manifest.json
```

## 4) Execute real R2 upload
```bash
cd /home/download-888vn/htdocs/download.888vn.net/app
R2_ENABLED=true \
R2_ACCOUNT_ID=YOUR_ACCOUNT_ID \
R2_ACCESS_KEY_ID=YOUR_ACCESS_KEY \
R2_SECRET_ACCESS_KEY=YOUR_SECRET_KEY \
R2_BUCKET=YOUR_BUCKET \
node scripts/migrate-upload-r2.mjs \
  --manifest /home/download-888vn/htdocs/download.888vn.net/migration-audit/r2-upload-manifest.json \
  --execute
```

Optional prefix:
```bash
node scripts/migrate-upload-r2.mjs \
  --manifest /path/to/r2-upload-manifest.json \
  --prefix production \
  --execute
```

## 5) Seed metadata for new Docker/Portainer runtime
```bash
mkdir -p /opt/download-hub/data
cp /home/download-888vn/htdocs/download.888vn.net/migration-audit/catalog-r2-preview.json /opt/download-hub/data/files.json
```

## 6) Validate seed file
```bash
cat /opt/download-hub/data/files.json | head
```

## 7) Deploy new stack (after env is ready)
Use:
- `deploy/portainer-stack.portainer-friendly.yml`
- `.env.production.example`
- `deploy/CUTOVER-RUNBOOK-ALPHA.md`

## 8) Rollback reminder
Do **not** delete the old legacy app/storage until:
- health checks pass
- admin login works
- R2 inventory loads
- at least one real file downloads successfully
