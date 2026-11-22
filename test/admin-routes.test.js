import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { generateKeyPair } from 'jose';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import adminRouter from '../src/routes/admin.js';
import { reloadConfig } from '../src/lib/config.js';
import { AUD, installAccessKeys, signAccessJwt } from './helpers/access.js';

async function makeValidAdminCookie() {
  return signAccessJwt();
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

  beforeAll(installAccessKeys);

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
      T43ID_ACCESS_AUD: AUD,
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
    const sessionToken = await makeValidAdminCookie();
    const res = await request(app)
      .get('/api/admin/files')
      .set('Cf-Access-Jwt-Assertion', sessionToken);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.files).toHaveLength(1);
    expect(res.body.files[0].disk.exists).toBe(true);
    expect(res.body.files[0].disk.sizeBytes).toBe(5);
    expect(res.body.extraDiskFiles).toHaveLength(0);
  });

  it('syncs files.json from disk and updates checksum + size', async () => {
    const sessionToken = await makeValidAdminCookie();
    const res = await request(app)
      .post('/api/admin/sync')
      .set('Cf-Access-Jwt-Assertion', sessionToken)
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

    const sessionToken = await makeValidAdminCookie();
    const res = await request(app)
      .post('/api/admin/sync')
      .set('Cf-Access-Jwt-Assertion', sessionToken)
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

  it('blocks cross-site POST requests', async () => {
    const sessionToken = await makeValidAdminCookie();
    const res = await request(app)
      .post('/api/admin/sync')
      .set('Cf-Access-Jwt-Assertion', sessionToken)
      .set('Sec-Fetch-Site', 'cross-site')
      .set('Content-Type', 'application/json')
      .send('{}');

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('cross_site_request_blocked');
  });

  it('accepts the CF_Authorization cookie', async () => {
    const res = await request(app)
      .get('/api/admin/files')
      .set('Cookie', `CF_Authorization=${await signAccessJwt()}`);
    expect(res.status).toBe(200);
  });

  it('rejects a bad audience, wrong group, foreign key and garbage token on API and page', async () => {
    const other = (await generateKeyPair('RS256')).privateKey;
    const tokens = [
      await signAccessJwt({ aud: 'other' }),
      await signAccessJwt({ groups: ['viewer'] }),
      await signAccessJwt({ key: other }),
      'garbage'
    ];
    for (const token of tokens) {
      const api = await request(app).get('/api/admin/r2/files').set('Cf-Access-Jwt-Assertion', token);
      expect(api.status).toBe(401);
      const page = await request(app).get('/admin/r2').set('Cf-Access-Jwt-Assertion', token);
      expect(page.status).toBe(403);
    }
  });

  it('has no password login route', async () => {
    expect((await request(app).get('/admin/login')).status).toBe(404);
    expect((await request(app).post('/admin/login').type('form').send({ username: 'a', password: 'b' })).status).toBe(404);
  });

  it('logout ends the Access session', async () => {
    const res = await request(app).post('/admin/logout');
    expect(res.headers.location).toBe('/cdn-cgi/access/logout');
  });
});
