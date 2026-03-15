import { beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import siteRouter from '../src/routes/site.js';
import { reloadConfig } from '../src/lib/config.js';

function makeApp() {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use((req, _res, next) => { req.cookies = {}; next(); });
  app.use(siteRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || 500).json({ ok: false, error: err.message });
  });
  return app;
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

describe('admin ops routes', () => {
  let tmpDir;
  let storageDir;
  let indexPath;
  let app;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'download-hub-admin-'));
    storageDir = path.join(tmpDir, 'storage');
    indexPath = path.join(tmpDir, 'files.json');
    await fs.mkdir(path.join(storageDir, 'windows'), { recursive: true });
    await fs.writeFile(path.join(storageDir, 'windows', 'tool.zip'), 'hello');
    await writeJson(indexPath, [
      {
        id: 'tool',
        slug: 'tool',
        title: { vi: 'Tool', en: 'Tool' },
        summary: { vi: 'Tool', en: 'Tool' },
        description: { vi: 'Tool', en: 'Tool' },
        version: '1.0.0',
        platform: 'Windows',
        language: ['vi', 'en'],
        sizeBytes: 1,
        checksumSha256: 'deadbeef',
        mimeType: 'application/zip',
        storage: {
          relativePath: 'windows/tool.zip',
          downloadName: 'tool.zip'
        },
        published: true,
        featured: false,
        demo: false,
        maxAllowedSizeBytes: 524288000,
        tags: [],
        updatedAt: '2026-03-15T00:00:00.000Z'
      }
    ]);

    reloadConfig({
      NODE_ENV: 'development',
      DOWNLOAD_TOKEN_SECRET: 'secret',
      TURNSTILE_ENABLED: 'false',
      HCAPTCHA_ENABLED: 'false',
      ADMIN_BEARER_TOKEN: 'admin-secret',
      FILES_STORAGE_PATH: storageDir,
      FILES_INDEX_PATH: indexPath
    });

    app = makeApp();
  });

  it('rejects admin files API without bearer token', async () => {
    const res = await request(app).get('/api/admin/files');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('unauthorized');
  });

  it('returns disk metadata and mismatch status inputs through admin files API', async () => {
    const res = await request(app)
      .get('/api/admin/files')
      .set('Authorization', 'Bearer admin-secret');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.files).toHaveLength(1);
    expect(res.body.files[0].disk.exists).toBe(true);
    expect(res.body.files[0].disk.sizeBytes).toBe(5);
    expect(res.body.extraDiskFiles).toHaveLength(0);
  });

  it('syncs files.json from disk and updates checksum + size', async () => {
    const res = await request(app)
      .post('/api/admin/sync')
      .set('Authorization', 'Bearer admin-secret');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.updated).toContain('windows/tool.zip');

    const saved = JSON.parse(await fs.readFile(indexPath, 'utf8'));
    expect(saved[0].sizeBytes).toBe(5);
    expect(saved[0].checksumSha256).toHaveLength(64);
  });

  it('creates a new files.json entry for an extra disk file', async () => {
    await fs.mkdir(path.join(storageDir, 'android'), { recursive: true });
    await fs.writeFile(path.join(storageDir, 'android', 'android-pack-v3.apk'), 'apk-data');

    const res = await request(app)
      .post('/api/admin/sync')
      .set('Authorization', 'Bearer admin-secret');

    expect(res.status).toBe(200);
    expect(res.body.created).toContain('android/android-pack-v3.apk');

    const saved = JSON.parse(await fs.readFile(indexPath, 'utf8'));
    const created = saved.find((item) => item.storage.relativePath === 'android/android-pack-v3.apk');
    expect(created).toBeTruthy();
    expect(created.published).toBe(false);
    expect(created.checksumSha256).toHaveLength(64);
    expect(created.sizeBytes).toBe(8);
  });
});
