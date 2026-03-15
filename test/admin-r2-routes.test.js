import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import adminRouter from '../src/routes/admin.js';
import { reloadConfig } from '../src/lib/config.js';
import { createHmacToken } from '../src/lib/utils.js';
import * as r2Client from '../src/lib/r2-client.js';

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
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
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

describe('admin R2 routes', () => {
  let tmpDir;
  let indexPath;
  let app;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'download-hub-r2-'));
    indexPath = path.join(tmpDir, 'files.json');
    await writeJson(indexPath, []);

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
      FILES_INDEX_PATH: indexPath,
      R2_ENABLED: 'true',
      R2_ACCOUNT_ID: 'acc',
      R2_ACCESS_KEY_ID: 'ak',
      R2_SECRET_ACCESS_KEY: 'sk',
      R2_BUCKET: 'bkt'
    });

    vi.spyOn(r2Client, 'isR2Configured').mockReturnValue(true);
    vi.spyOn(r2Client, 'listR2Objects').mockResolvedValue([
      { key: 'foo.apk', sizeBytes: 10, lastModified: '2024-01-01T00:00:00Z' }
    ]);
    vi.spyOn(r2Client, 'deleteR2Object').mockResolvedValue(true);
    vi.spyOn(r2Client, 'getPresignedUploadUrl').mockReturnValue('https://r2/upload');
    vi.spyOn(r2Client, 'getPresignedDownloadUrl').mockReturnValue('https://r2/download');

    app = makeApp();
  });

  it('requires admin session for r2 files list', async () => {
    const res = await request(app).get('/api/admin/r2/files');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('admin_session_required');
  });

  it('lists merged r2 files when session cookie is present', async () => {
    const sessionToken = makeValidAdminCookie();
    const res = await request(app)
      .get('/api/admin/r2/files')
      .set('Cookie', `dl888_admin_sess=${sessionToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.files.length).toBe(1);
    expect(res.body.files[0].r2Key).toBe('foo.apk');
  });

  it('returns presigned upload url', async () => {
    const sessionToken = makeValidAdminCookie();
    const csrfToken = makeCsrfToken(sessionToken);
    const res = await request(app)
      .post('/api/admin/r2/upload-url')
      .set('Cookie', `dl888_admin_sess=${sessionToken}`)
      .set('X-CSRF-Token', csrfToken)
      .send({ filename: 'bar.exe', contentType: 'application/vnd.microsoft.portable-executable' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.uploadUrl).toMatch(/https:\/\/r2\/upload/);
    expect(res.body.r2Key).toBe('bar.exe');
  });

  it('deletes r2 file and removes catalog entry', async () => {
    // Seed catalog
    const seed = [
      {
        id: 'foo',
        slug: 'foo',
        title: { vi: 'Foo', en: 'Foo' },
        summary: { vi: '', en: '' },
        description: { vi: '', en: '' },
        version: '1.0.0',
        platform: 'Android',
        language: ['vi', 'en'],
        sizeBytes: 10,
        checksumSha256: '0'.repeat(64),
        mimeType: 'application/octet-stream',
        r2: { key: 'foo.apk', downloadName: 'foo.apk' },
        published: true,
        featured: false,
        demo: false,
        tags: [],
        updatedAt: '2024-01-01T00:00:00Z'
      }
    ];
    await writeJson(indexPath, seed);

    const sessionToken = makeValidAdminCookie();
    const csrfToken = makeCsrfToken(sessionToken);
    const res = await request(app)
      .delete('/api/admin/r2/files/foo')
      .set('Cookie', `dl888_admin_sess=${sessionToken}`)
      .set('X-CSRF-Token', csrfToken);

    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe('foo');
    const saved = JSON.parse(await fs.readFile(indexPath, 'utf8'));
    expect(saved.length).toBe(0);
  });

  it('rejects state-mutating requests without valid CSRF token', async () => {
    const sessionToken = makeValidAdminCookie();
    const res = await request(app)
      .post('/api/admin/r2/sync')
      .set('Cookie', `dl888_admin_sess=${sessionToken}`)
      .set('X-CSRF-Token', 'bad-token');

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('csrf_token_invalid');
  });
});
