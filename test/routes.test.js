import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import siteRouter from '../src/routes/site.js';
import { reloadConfig } from '../src/lib/config.js';
import { issueDownloadToken } from '../src/lib/download-token.js';
import * as r2Storage from '../src/lib/r2-storage.js';
import * as dropboxClient from '../src/lib/dropbox-client.js';

function makeApp() {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use((req, _res, next) => {
    req.cookies = {};
    const testIp = req.headers['x-test-ip'];
    if (testIp) {
      Object.defineProperty(req, 'ip', { value: testIp, configurable: true });
    }
    next();
  });
  app.use(siteRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || 500).json({ ok: false, error: err.message });
  });
  return app;
}

describe('routes', () => {
  let tmpDir;
  let indexPath;
  let storagePath;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'download-hub-routes-'));
    indexPath = path.join(tmpDir, 'files.json');
    storagePath = path.join(tmpDir, 'storage');
    await fs.mkdir(storagePath, { recursive: true });
    reloadConfig({
      NODE_ENV: 'development',
      DOWNLOAD_TOKEN_SECRET: 'secret',
      TURNSTILE_ENABLED: 'false',
      HCAPTCHA_ENABLED: 'false',
      FILES_INDEX_PATH: indexPath,
      FILES_STORAGE_PATH: storagePath,
      R2_ENABLED: 'true',
      R2_ACCOUNT_ID: 'acc',
      R2_ACCESS_KEY_ID: 'ak',
      R2_SECRET_ACCESS_KEY: 'sk',
      R2_BUCKET: 'bucket'
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects verify endpoint when content-type is not form', async () => {
    await fs.writeFile(indexPath, '[]\n', 'utf8');
    const app = makeApp();
    const res = await request(app).post('/api/verify/slug').set('Content-Type', 'application/json').send({});
    expect(res.status).toBe(415);
    expect(res.body.error).toBe('unsupported_media_type');
  });

  it('downloads a published legacy r2.key-only entry through /files/:slug', async () => {
    await fs.writeFile(indexPath, `${JSON.stringify([{
      id: 'legacy-r2-only',
      slug: 'legacy-r2-only',
      title: { vi: 'Legacy', en: 'Legacy' },
      summary: { vi: '', en: '' },
      description: { vi: '', en: '' },
      version: '1.0.0',
      platform: 'Windows',
      language: ['vi', 'en'],
      sizeBytes: 123,
      checksumSha256: '0'.repeat(64),
      mimeType: 'application/zip',
      r2: { key: 'windows/legacy.zip', downloadName: 'legacy.zip' },
      published: true,
      featured: false,
      demo: false,
      tags: [],
      updatedAt: '2026-03-15T00:00:00Z'
    }], null, 2)}\n`, 'utf8');

    const streamSpy = vi.spyOn(r2Storage, 'streamFromR2').mockImplementation(async (_file, res) => {
      res.status(200).set('Content-Type', 'application/zip').end('r2-ok');
    });

    const token = await issueDownloadToken(
      { slug: 'legacy-r2-only', storage: { objectKey: 'windows/legacy.zip', downloadName: 'legacy.zip' } },
      { ip: '1.2.3.4', get: () => 'test-agent' }
    );

    const app = makeApp();
    const res = await request(app)
      .get(`/files/legacy-r2-only?token=${encodeURIComponent(token)}`)
      .set('User-Agent', 'test-agent')
      .set('X-Test-IP', '1.2.3.4');

    expect(res.status).toBe(200);
    expect(res.text).toBe('r2-ok');
    expect(streamSpy).toHaveBeenCalledTimes(1);
    expect(streamSpy.mock.calls[0][0].storage.objectKey).toBe('windows/legacy.zip');
  });

  it('keeps upload-confirm or sync-style metadata downloadable via canonical storage contract', async () => {
    await fs.writeFile(indexPath, `${JSON.stringify([{
      id: 'sync-style',
      slug: 'sync-style',
      title: { vi: 'Sync', en: 'Sync' },
      summary: { vi: '', en: '' },
      description: { vi: '', en: '' },
      version: '1.0.0',
      platform: 'Android',
      language: ['vi', 'en'],
      sizeBytes: 321,
      checksumSha256: '1'.repeat(64),
      mimeType: 'application/vnd.android.package-archive',
      storage: {
        objectKey: 'android/app.apk',
        r2Key: 'android/app.apk',
        relativePath: 'android/app.apk',
        downloadName: 'app.apk'
      },
      published: true,
      featured: false,
      demo: false,
      tags: [],
      updatedAt: '2026-03-15T00:00:00Z'
    }], null, 2)}\n`, 'utf8');

    const streamSpy = vi.spyOn(r2Storage, 'streamFromR2').mockImplementation(async (_file, res) => {
      res.status(200).set('Content-Type', 'application/vnd.android.package-archive').end('sync-ok');
    });

    const token = await issueDownloadToken(
      { slug: 'sync-style', storage: { objectKey: 'android/app.apk', downloadName: 'app.apk' } },
      { ip: '1.2.3.4', get: () => 'test-agent' }
    );

    const app = makeApp();
    const res = await request(app)
      .get(`/files/sync-style?token=${encodeURIComponent(token)}`)
      .set('User-Agent', 'test-agent')
      .set('X-Test-IP', '1.2.3.4');

    expect(res.status).toBe(200);
    expect(res.text).toBe('sync-ok');
    expect(streamSpy).toHaveBeenCalledTimes(1);
  });

  it('streams a dropbox file when dropbox is configured', async () => {
    await fs.writeFile(indexPath, `${JSON.stringify([{
      id: 'dropbox-file',
      slug: 'dropbox-file',
      title: { vi: 'Dropbox', en: 'Dropbox' },
      summary: { vi: '', en: '' },
      description: { vi: '', en: '' },
      version: '1.0.0',
      platform: 'Generic',
      language: ['vi', 'en'],
      sizeBytes: 512,
      checksumSha256: '3'.repeat(64),
      mimeType: 'application/zip',
      storage: { provider: 'dropbox', dropboxPath: '/apps/dl888/test.zip', downloadName: 'test.zip' },
      published: true,
      featured: false,
      demo: false,
      tags: [],
      updatedAt: '2026-05-06T00:00:00Z'
    }], null, 2)}\n`, 'utf8');

    vi.spyOn(dropboxClient, 'isDropboxConfigured').mockReturnValue(true);
    const streamSpy = vi.spyOn(dropboxClient, 'streamFromDropbox').mockImplementation(async (_file, res) => {
      res.status(200).set('Content-Type', 'application/zip').end('dropbox-ok');
    });

    const token = await issueDownloadToken(
      { slug: 'dropbox-file', storage: { provider: 'dropbox', dropboxPath: '/apps/dl888/test.zip' } },
      { ip: '1.2.3.4', get: () => 'test-agent' }
    );

    const app = makeApp();
    const res = await request(app)
      .get(`/files/dropbox-file?token=${encodeURIComponent(token)}`)
      .set('User-Agent', 'test-agent')
      .set('X-Test-IP', '1.2.3.4');

    expect(res.status).toBe(200);
    expect(res.text).toBe('dropbox-ok');
    expect(streamSpy).toHaveBeenCalledTimes(1);
  });

  it('returns 503 when dropbox file requested but dropbox not configured', async () => {
    await fs.writeFile(indexPath, `${JSON.stringify([{
      id: 'dropbox-missing',
      slug: 'dropbox-missing',
      title: { vi: 'Dropbox', en: 'Dropbox' },
      summary: { vi: '', en: '' },
      description: { vi: '', en: '' },
      version: '1.0.0',
      platform: 'Generic',
      language: ['vi', 'en'],
      sizeBytes: 512,
      checksumSha256: '4'.repeat(64),
      mimeType: 'application/zip',
      storage: { provider: 'dropbox', dropboxPath: '/apps/dl888/test.zip', downloadName: 'test.zip' },
      published: true,
      featured: false,
      demo: false,
      tags: [],
      updatedAt: '2026-05-06T00:00:00Z'
    }], null, 2)}\n`, 'utf8');

    vi.spyOn(dropboxClient, 'isDropboxConfigured').mockReturnValue(false);

    const token = await issueDownloadToken(
      { slug: 'dropbox-missing', storage: { provider: 'dropbox', dropboxPath: '/apps/dl888/test.zip' } },
      { ip: '1.2.3.4', get: () => 'test-agent' }
    );

    const app = makeApp();
    const res = await request(app)
      .get(`/files/dropbox-missing?token=${encodeURIComponent(token)}`)
      .set('User-Agent', 'test-agent')
      .set('X-Test-IP', '1.2.3.4');

    expect(res.status).toBe(503);
  });

  it('does not false-fallthrough malformed R2 entries to local Invalid storage path', async () => {
    await fs.writeFile(indexPath, `${JSON.stringify([{
      id: 'malformed-r2',
      slug: 'malformed-r2',
      title: { vi: 'Bad', en: 'Bad' },
      summary: { vi: '', en: '' },
      description: { vi: '', en: '' },
      version: '1.0.0',
      platform: 'Generic',
      language: ['vi', 'en'],
      sizeBytes: 0,
      checksumSha256: '2'.repeat(64),
      mimeType: 'application/octet-stream',
      r2: {},
      published: true,
      featured: false,
      demo: false,
      tags: [],
      updatedAt: '2026-03-15T00:00:00Z'
    }], null, 2)}\n`, 'utf8');

    const streamSpy = vi.spyOn(r2Storage, 'streamFromR2');
    const token = await issueDownloadToken(
      { slug: 'malformed-r2', storage: { downloadName: 'download.bin' } },
      { ip: '1.2.3.4', get: () => 'test-agent' }
    );

    const app = makeApp();
    const res = await request(app)
      .get(`/files/malformed-r2?token=${encodeURIComponent(token)}`)
      .set('User-Agent', 'test-agent')
      .set('X-Test-IP', '1.2.3.4');

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Invalid storage path');
    expect(streamSpy).not.toHaveBeenCalled();
  });
});
