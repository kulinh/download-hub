# Alpha Cutover — Copy/Paste Block

> Run step by step. Do not paste blindly into production without reviewing values.

## 1. Backup + export current state
```bash
mkdir -p /home/download-888vn/backup-$(date +%F-%H%M)
BACKUP_DIR=/home/download-888vn/backup-$(date +%F-%H%M)

cp -a /home/download-888vn/htdocs/download.888vn.net/app/.env "$BACKUP_DIR/" || true
cp -a /home/download-888vn/htdocs/download.888vn.net/app/src/data/files.json "$BACKUP_DIR/" || true
cp -a /home/download-888vn/htdocs/download.888vn.net/storage/files "$BACKUP_DIR/storage-files" || true

cd /home/download-888vn/htdocs/download.888vn.net/app
node scripts/migrate-export.mjs \
  --catalog ./src/data/files.json \
  --storage /home/download-888vn/htdocs/download.888vn.net/storage/files \
  --out /home/download-888vn/htdocs/download.888vn.net/migration-audit
```

## 2. Dry-run R2 upload
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

## 3. Real R2 upload
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

## 4. Seed new persistent metadata
```bash
mkdir -p /opt/download-hub/data
cp /home/download-888vn/htdocs/download.888vn.net/migration-audit/catalog-r2-preview.json /opt/download-hub/data/files.json
```

## 5. Prepare new app workspace
```bash
mkdir -p /opt/download-hub/app
cd /opt/download-hub/app
# put/download the new repo source here before continuing
```

## 6. Prepare env file
```bash
cp .env.production.alpha.template .env
# edit .env with real secrets/keys before deploy
```

## 7. Deploy in Portainer
Use:
- `deploy/portainer-stack.portainer-friendly.yml`
- `.env` values above

## 8. Verify container locally
```bash
curl http://127.0.0.1:3000/health
```

## 9. Switch CloudPanel reverse proxy
Point CloudPanel vhost to:
- `http://127.0.0.1:3000`

Then test:
```bash
curl -I https://download.888vn.net/health
```

## 10. Smoke test before declaring success
- homepage OK
- file detail page OK
- Turnstile OK
- `/admin/login` OK
- admin login OK
- `/admin/r2` OK
- R2 inventory OK
- one real file download OK

## 11. Rollback if needed
- restore old CloudPanel upstream/vhost config
- stop Docker stack
- restart old runtime
- re-test `/health` and 1 real download before re-opening traffic
