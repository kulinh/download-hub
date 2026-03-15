import { beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import adminRouter from '../src/routes/admin.js';
import { reloadConfig } from '../src/lib/config.js';
import { createHmacToken } from '../src/lib/utils.js';

const TEST_SESSION_SECRET = 'test-admin-session-secret-32chars!!';
const TEST_ADMIN_USER = 'testadmin';
const TEST_ADMIN_PASS = 'testpassword';

function makeValidAdminCookie() {
  const expiresAt = Date.now() + 3600 * 1000;
  const payload = { role: 'admin', exp: expiresAt };
  return createHmacToken(payload, TEST_SESSION_SECRET);
}

/**
 * CSRF token is derived as the last 16 characters of the session cookie.
 * This mirrors the logic in requireAdminSession middleware.
 */
function makeCsrfToken(sessionToken) {
  return sessionToken.slice(-16);
}

function makeApp() {
  const app = express();
  // Mirror production parser setup: urlencoded global, json scoped to /api only.
  app.use(express.urlencoded({ extended: false }));
  app.use('/api', express.json());
  app.use(cookieParser());
  app.use(adminRouter);
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
      DOWNLOAD_TOKEN_SECRET: 'dev-secret-change-me',
      TURNSTILE_ENABLED: 'false',
      HCAPTCHA_ENABLED: 'false',
      ADMIN_USERNAME: TEST_ADMIN_USER,
      ADMIN_PASSWORD: TEST_ADMIN_PASS,
      ADMIN_SESSION_SECRET: TEST_SESSION_SECRET,
      ADMIN_SESSION_TTL_SECONDS: '3600',
      ADMIN_COOKIE_NAME: 'dl888_admin_sess',
      ADMIN_BEARER_TOKEN: 'admin-secret',
      FILES_STORAGE_PATH: storageDir,
      FILES_INDEX_PATH: indexPath
    });

    app = makeApp();
  });

  it('rejects admin files API without session cookie', async () => {
    const res = await request(app).get('/api/admin/files');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('admin_session_required');
  });

  it('returns disk metadata through admin files API with valid session cookie', async () => {
    const sessionToken = makeValidAdminCookie();
    const res = await request(app)
      .get('/api/admin/files')
      .set('Cookie', `dl888_admin_sess=${sessionToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.files).toHaveLength(1);
    expect(res.body.files[0].disk.exists).toBe(true);
    expect(res.body.files[0].disk.sizeBytes).toBe(5);
    expect(res.body.extraDiskFiles).toHaveLength(0);
  });

  it('syncs files.json from disk and updates checksum + size', async () => {
    const sessionToken = makeValidAdminCookie();
    const csrfToken = makeCsrfToken(sessionToken);
    const res = await request(app)
      .post('/api/admin/sync')
      .set('Cookie', `dl888_admin_sess=${sessionToken}`)
      .set('X-CSRF-Token', csrfToken)
      .set('Content-Type', 'application/json')
      .send('{}');

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

    const sessionToken = makeValidAdminCookie();
    const csrfToken = makeCsrfToken(sessionToken);
    const res = await request(app)
      .post('/api/admin/sync')
      .set('Cookie', `dl888_admin_sess=${sessionToken}`)
      .set('X-CSRF-Token', csrfToken)
      .set('Content-Type', 'application/json')
      .send('{}');

    expect(res.status).toBe(200);
    expect(res.body.created).toContain('android/android-pack-v3.apk');

    const saved = JSON.parse(await fs.readFile(indexPath, 'utf8'));
    const created = saved.find((item) => item.storage.relativePath === 'android/android-pack-v3.apk');
    expect(created).toBeTruthy();
    expect(created.published).toBe(false);
    expect(created.checksumSha256).toHaveLength(64);
    expect(created.sizeBytes).toBe(8);
  });

  it('rejects POST requests without valid CSRF token', async () => {
    const sessionToken = makeValidAdminCookie();
    const res = await request(app)
      .post('/api/admin/sync')
      .set('Cookie', `dl888_admin_sess=${sessionToken}`)
      .set('X-CSRF-Token', 'invalid-csrf-token')
      .set('Content-Type', 'application/json')
      .send('{}');

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('csrf_token_invalid');
  });
});
