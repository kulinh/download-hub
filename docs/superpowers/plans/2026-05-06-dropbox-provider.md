# Dropbox Storage Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Dropbox as a server-proxy storage provider so admin can link files stored in Dropbox and users download them through the app (captcha-gated, URL hidden).

**Architecture:** Dropbox files are referenced in `files.json` by their Dropbox path (`/apps/dl888/file.zip`). When a user hits `/files/:slug?token=...`, the server fetches the file from Dropbox using the Content Download API and pipes the stream back to the browser — identical flow to R2. A long-lived refresh token (set once in `.env`) is exchanged for short-lived access tokens, cached in-process. Admin registers files via `POST /api/admin/dropbox/link`.

**Tech Stack:** Dropbox API v2 (native `fetch`, no SDK), Node.js streams, existing Express/EJS admin UI pattern.

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/lib/dropbox-client.js` | Token refresh + `streamFromDropbox()` |
| Modify | `src/lib/config.js` | Add `dropbox` config block |
| Modify | `src/lib/storage-metadata.js` | Recognise `'dropbox'` provider, add `getDropboxPath()` |
| Modify | `src/lib/download-token.js` | Route `dropbox` provider in `streamDownload()` |
| Modify | `src/routes/site.js` | Add dropbox availability guard in `/files/:slug` |
| Modify | `src/routes/admin.js` | Add `POST /api/admin/dropbox/link` + `GET /api/admin/dropbox/files` |
| Modify | `.env.example` | Document `DROPBOX_APP_KEY/SECRET/REFRESH_TOKEN` |
| Create | `test/dropbox-client.test.js` | Unit tests (mocked fetch) |
| Modify | `test/routes.test.js` | Integration test for dropbox download route |

---

## Dropbox API Reference

- **Token refresh**: `POST https://api.dropbox.com/oauth2/token`
  - Body (form-encoded): `grant_type=refresh_token&refresh_token=<token>&client_id=<key>&client_secret=<secret>`
  - Returns: `{ access_token, expires_in }` (access token lives ~4 hours)

- **Download file**: `POST https://content.dropboxapi.com/2/files/download`
  - Headers: `Authorization: Bearer <access_token>`, `Dropbox-API-Arg: {"path":"/path/to/file.zip"}`
  - Returns: file stream; headers include `dropbox-api-result` JSON with `name`, `size`

- **Get metadata**: `POST https://api.dropboxapi.com/2/files/get_metadata`
  - Body (JSON): `{"path":"/path/to/file.zip"}`
  - Returns: `{ name, size, ... }`

---

## Catalog Entry Schema (Dropbox)

```json
{
  "id": "myapp-1234567890",
  "slug": "myapp",
  "title": { "vi": "MyApp", "en": "MyApp" },
  "summary": { "vi": "", "en": "" },
  "version": "1.0.0",
  "platform": "Windows",
  "sizeBytes": 1048576,
  "mimeType": "application/octet-stream",
  "storage": {
    "provider": "dropbox",
    "dropboxPath": "/apps/dl888/myapp.zip",
    "downloadName": "myapp.zip"
  },
  "storageProvider": "dropbox",
  "published": false
}
```

---

## Task 1: Add Dropbox config

**Files:**
- Modify: `src/lib/config.js`
- Modify: `.env.example`

- [ ] **Step 1: Add dropbox block to `buildConfig()` in `src/lib/config.js`**

  Find the `admin: { ... }` block (around line 90) and add after it:

  ```js
  dropbox: {
    enabled: toBool(env.DROPBOX_ENABLED, false),
    appKey: env.DROPBOX_APP_KEY || '',
    appSecret: env.DROPBOX_APP_SECRET || '',
    refreshToken: env.DROPBOX_REFRESH_TOKEN || ''
  },
  ```

- [ ] **Step 2: Add `isDropboxConfigured()` derived flag after `cfg.captchaProvider = detectCaptchaProvider(cfg);`**

  ```js
  cfg.dropbox = {
    ...cfg.dropbox,
    enabled: cfg.dropbox.enabled && Boolean(cfg.dropbox.appKey && cfg.dropbox.appSecret && cfg.dropbox.refreshToken)
  };
  ```

- [ ] **Step 3: Add to `.env.example`**

  Append at end of file:

  ```
  # ── Dropbox storage provider (optional) ───────────────────────────────────────
  # Create app at https://www.dropbox.com/developers/apps (Full Dropbox or App Folder scope)
  # Generate refresh token: https://dropbox.tech/developers/pkce--what-and-why-
  # Or use the Dropbox API Explorer to get a long-lived token.
  DROPBOX_ENABLED=false
  DROPBOX_APP_KEY=your-dropbox-app-key
  DROPBOX_APP_SECRET=your-dropbox-app-secret
  DROPBOX_REFRESH_TOKEN=your-dropbox-refresh-token
  ```

- [ ] **Step 4: Verify module loads**

  ```bash
  node --env-file=.env -e "import('./src/lib/config.js').then(m => console.log('dropbox.enabled:', m.config.dropbox?.enabled))"
  ```

  Expected: `dropbox.enabled: false`

- [ ] **Step 5: Commit**

  ```bash
  git add src/lib/config.js .env.example
  git commit -m "feat(dropbox): add config block and env vars"
  ```

---

## Task 2: Create `src/lib/dropbox-client.js`

**Files:**
- Create: `src/lib/dropbox-client.js`

This module owns all Dropbox API calls. It caches the access token in-process and refreshes it before expiry. No external dependencies — uses native `fetch`.

- [ ] **Step 1: Write failing test first** in `test/dropbox-client.test.js`

  ```js
  import { beforeEach, describe, expect, it, vi } from 'vitest';
  import { reloadConfig } from '../src/lib/config.js';

  // Must import after reloadConfig so module picks up test config
  let dropboxClient;

  beforeEach(async () => {
    reloadConfig({
      NODE_ENV: 'development',
      DROPBOX_ENABLED: 'true',
      DROPBOX_APP_KEY: 'test-key',
      DROPBOX_APP_SECRET: 'test-secret',
      DROPBOX_REFRESH_TOKEN: 'test-refresh',
      DOWNLOAD_TOKEN_SECRET: 'secret',
      TURNSTILE_ENABLED: 'false',
      HCAPTCHA_ENABLED: 'false',
      FILES_INDEX_PATH: '/tmp/files.json',
      FILES_STORAGE_PATH: '/tmp/storage'
    });
    vi.resetModules();
    dropboxClient = await import('../src/lib/dropbox-client.js');
  });

  describe('isDropboxConfigured', () => {
    it('returns true when all dropbox env vars set', () => {
      expect(dropboxClient.isDropboxConfigured()).toBe(true);
    });

    it('returns false when DROPBOX_ENABLED is false', async () => {
      reloadConfig({
        NODE_ENV: 'development',
        DROPBOX_ENABLED: 'false',
        DROPBOX_APP_KEY: 'test-key',
        DROPBOX_APP_SECRET: 'test-secret',
        DROPBOX_REFRESH_TOKEN: 'test-refresh',
        DOWNLOAD_TOKEN_SECRET: 'secret',
        TURNSTILE_ENABLED: 'false',
        HCAPTCHA_ENABLED: 'false',
        FILES_INDEX_PATH: '/tmp/files.json',
        FILES_STORAGE_PATH: '/tmp/storage'
      });
      vi.resetModules();
      const mod = await import('../src/lib/dropbox-client.js');
      expect(mod.isDropboxConfigured()).toBe(false);
    });
  });

  describe('getAccessToken', () => {
    it('fetches and caches access token via refresh token flow', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: 'tok-abc', expires_in: 14400 })
      });
      vi.stubGlobal('fetch', mockFetch);

      const token = await dropboxClient.getAccessToken();
      expect(token).toBe('tok-abc');
      expect(mockFetch).toHaveBeenCalledOnce();

      // Second call should use cache — no second fetch
      const token2 = await dropboxClient.getAccessToken();
      expect(token2).toBe('tok-abc');
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it('throws when Dropbox returns error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        text: async () => 'invalid_grant'
      }));

      await expect(dropboxClient.getAccessToken()).rejects.toThrow('dropbox_token_refresh_failed');
    });
  });

  describe('getDropboxMetadata', () => {
    it('returns file name and size', async () => {
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'tok', expires_in: 14400 }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ name: 'file.zip', size: 1024, '.tag': 'file' }) })
      );
      const meta = await dropboxClient.getDropboxMetadata('/apps/dl888/file.zip');
      expect(meta.name).toBe('file.zip');
      expect(meta.size).toBe(1024);
    });
  });
  ```

- [ ] **Step 2: Run test — expect FAIL (module doesn't exist yet)**

  ```bash
  npm test -- --reporter=verbose test/dropbox-client.test.js 2>&1 | tail -15
  ```

  Expected: `Cannot find module '../src/lib/dropbox-client.js'`

- [ ] **Step 3: Create `src/lib/dropbox-client.js`**

  ```js
  import { config } from './config.js';

  const TOKEN_URL = 'https://api.dropbox.com/oauth2/token';
  const DOWNLOAD_URL = 'https://content.dropboxapi.com/2/files/download';
  const METADATA_URL = 'https://api.dropboxapi.com/2/files/get_metadata';

  // In-process token cache
  let _cachedToken = null;
  let _tokenExpiresAt = 0;

  export function isDropboxConfigured() {
    return Boolean(
      config.dropbox?.enabled &&
      config.dropbox?.appKey &&
      config.dropbox?.appSecret &&
      config.dropbox?.refreshToken
    );
  }

  export async function getAccessToken() {
    if (_cachedToken && Date.now() < _tokenExpiresAt - 60_000) {
      return _cachedToken;
    }

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: config.dropbox.refreshToken,
      client_id: config.dropbox.appKey,
      client_secret: config.dropbox.appSecret
    });

    const resp = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(10_000)
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`dropbox_token_refresh_failed: ${resp.status} ${text.slice(0, 200)}`);
    }

    const data = await resp.json();
    _cachedToken = data.access_token;
    // expires_in is in seconds; default 14400 (4 hours) if missing
    _tokenExpiresAt = Date.now() + ((data.expires_in || 14400) * 1000);
    return _cachedToken;
  }

  export async function getDropboxMetadata(dropboxPath) {
    const token = await getAccessToken();
    const resp = await fetch(METADATA_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ path: dropboxPath }),
      signal: AbortSignal.timeout(10_000)
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`dropbox_metadata_failed: ${resp.status} ${text.slice(0, 200)}`);
    }

    return resp.json();
  }

  export async function streamFromDropbox(fileItem, res) {
    if (!isDropboxConfigured()) {
      const err = new Error('dropbox_not_configured');
      err.statusCode = 503;
      throw err;
    }

    const dropboxPath = fileItem?.storage?.dropboxPath;
    if (!dropboxPath) {
      const err = new Error('File has no Dropbox path configured');
      err.statusCode = 500;
      throw err;
    }

    const token = await getAccessToken();
    const downloadResp = await fetch(DOWNLOAD_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Dropbox-API-Arg': JSON.stringify({ path: dropboxPath })
      },
      signal: AbortSignal.timeout(30_000)
    });

    if (!downloadResp.ok) {
      const text = await downloadResp.text().catch(() => '');
      const err = new Error(`dropbox_download_failed: ${downloadResp.status} ${text.slice(0, 200)}`);
      err.statusCode = downloadResp.status === 409 ? 404 : 502;
      throw err;
    }

    // Dropbox returns file metadata in this response header
    let dropboxMeta = {};
    try {
      dropboxMeta = JSON.parse(downloadResp.headers.get('dropbox-api-result') || '{}');
    } catch (_) { /* noop */ }

    const downloadName = sanitizeFilename(
      fileItem?.storage?.downloadName || dropboxMeta.name || 'download.bin'
    );
    const contentLength = dropboxMeta.size || fileItem.sizeBytes;

    res.setHeader('Content-Type', fileItem.mimeType || 'application/octet-stream');
    if (contentLength) res.setHeader('Content-Length', contentLength);
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');

    // Pipe the Web ReadableStream (fetch response body) to the Express response
    const reader = downloadResp.body.getReader();
    return new Promise((resolve, reject) => {
      res.on('error', reject);
      res.on('close', resolve);

      function pump() {
        reader.read().then(({ done, value }) => {
          if (done) { res.end(); resolve(); return; }
          const ok = res.write(value);
          if (ok) { pump(); } else { res.once('drain', pump); }
        }).catch(reject);
      }

      pump();
    });
  }

  function sanitizeFilename(name) {
    return String(name).replace(/[\r\n"]/g, '_');
  }

  // Exported for testing only — reset cached token
  export function _resetTokenCache() {
    _cachedToken = null;
    _tokenExpiresAt = 0;
  }
  ```

- [ ] **Step 4: Run tests — expect PASS**

  ```bash
  npm test -- --reporter=verbose test/dropbox-client.test.js 2>&1 | tail -20
  ```

  Expected: all `dropbox-client` tests pass.

- [ ] **Step 5: Commit**

  ```bash
  git add src/lib/dropbox-client.js test/dropbox-client.test.js
  git commit -m "feat(dropbox): add dropbox-client with token refresh and stream"
  ```

---

## Task 3: Extend `storage-metadata.js` for Dropbox provider

**Files:**
- Modify: `src/lib/storage-metadata.js`

- [ ] **Step 1: Add `getDropboxPath()` export and extend `getStorageProvider()`**

  In `getStorageProvider()`, extend the provider detection:

  ```js
  export function getStorageProvider(fileItem) {
    const provider = fileItem?.storage?.provider || fileItem?.storageProvider;
    if (provider === 'r2' || provider === 'local' || provider === 'dropbox') return provider;
    if (fileItem?.storage?.dropboxPath) return 'dropbox';
    if (fileItem?.storage?.objectKey || fileItem?.storage?.r2Key || fileItem?.r2?.key) return 'r2';
    if (fileItem?.storage?.relativePath) return 'local';
    return 'local';
  }
  ```

  Add new export after `getStorageObjectKey`:

  ```js
  export function getDropboxPath(fileItem) {
    return fileItem?.storage?.dropboxPath || '';
  }
  ```

- [ ] **Step 2: Extend `normalizeFileEntry()` to handle dropbox provider**

  Find the section starting `const provider = getStorageProvider(fileItem) === 'r2' ? 'r2' : 'local';` and replace the whole provider normalisation logic:

  ```js
  export function normalizeFileEntry(fileItem) {
    if (!fileItem || typeof fileItem !== 'object') return fileItem;

    const provider = getStorageProvider(fileItem);

    const objectKey = provider === 'r2'
      ? normalizeObjectKey(fileItem?.storage?.objectKey || fileItem?.storage?.r2Key || fileItem?.r2?.key || '')
      : '';
    const relativePath = provider === 'local' ? getLocalRelativePath(fileItem) : '';
    const dropboxPath = provider === 'dropbox' ? (fileItem?.storage?.dropboxPath || '') : '';
    const downloadName = fileItem?.storage?.downloadName
      || fileItem?.r2?.downloadName
      || (objectKey ? path.basename(objectKey) : '')
      || (relativePath ? path.basename(relativePath) : '')
      || (dropboxPath ? path.basename(dropboxPath) : '')
      || 'download.bin';

    let storage = { ...(fileItem.storage || {}), provider, downloadName };

    if (provider === 'r2' && objectKey) {
      storage = { ...storage, objectKey, r2Key: objectKey };
      delete storage.relativePath;
      delete storage.dropboxPath;
    } else if (provider === 'dropbox') {
      storage = { ...storage, dropboxPath };
      delete storage.objectKey;
      delete storage.r2Key;
      delete storage.relativePath;
    } else {
      storage = { ...storage, ...(relativePath ? { relativePath } : {}) };
      delete storage.objectKey;
      delete storage.r2Key;
      delete storage.dropboxPath;
    }

    const normalized = { ...fileItem, storage, storageProvider: provider };

    if (provider === 'r2' && objectKey) {
      normalized.r2 = { ...(fileItem.r2 || {}), key: objectKey, downloadName };
    } else {
      delete normalized.r2;
    }

    return normalized;
  }
  ```

- [ ] **Step 3: Run full test suite**

  ```bash
  npm test 2>&1 | tail -15
  ```

  Expected: all 37 tests still pass.

- [ ] **Step 4: Commit**

  ```bash
  git add src/lib/storage-metadata.js
  git commit -m "feat(dropbox): extend storage-metadata to recognise dropbox provider"
  ```

---

## Task 4: Route Dropbox downloads in `download-token.js`

**Files:**
- Modify: `src/lib/download-token.js`

`streamDownload()` currently handles `r2` and `local`. Add `dropbox`.

- [ ] **Step 1: Import dropbox-client at top of file**

  Add to existing imports in `src/lib/download-token.js`:

  ```js
  import { isDropboxConfigured, streamFromDropbox } from './dropbox-client.js';
  import { getDropboxPath } from './storage-metadata.js';
  ```

- [ ] **Step 2: Extend `streamDownload()` to handle dropbox provider**

  Replace the current `streamDownload` body:

  ```js
  export async function streamDownload(fileItem, req, res, absolutePath) {
    const provider = getStorageProvider(fileItem);

    if (provider === 'dropbox') {
      return streamFromDropbox(fileItem, res);
    }

    if (isR2Enabled() && getStorageObjectKey(fileItem)) {
      return streamFromR2(fileItem, res);
    }

    // Local path
    const relPath = getLocalRelativePath(fileItem);
    const resolved = absolutePath || path.resolve(config.filesStoragePath, relPath);
    const stat = await fs.stat(resolved);
    res.setHeader('Content-Type', fileItem.mimeType || 'application/octet-stream');
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Content-Disposition', `attachment; filename="${sanitizeFilename(getStorageDownloadName(fileItem))}"`);
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');

    if (config.useXAccelRedirect) {
      const internalPath = path.posix.join(
        config.xAccelInternalPrefix,
        relPath.split(path.sep).join('/')
      );
      res.setHeader('X-Accel-Redirect', internalPath);
      return res.status(200).end();
    }

    return res.sendFile(resolved);
  }
  ```

  Also add `getStorageProvider` to the import from `./storage-metadata.js`:

  ```js
  import { getDropboxPath, getLocalRelativePath, getStorageDownloadName, getStorageObjectKey, getStorageProvider } from './storage-metadata.js';
  ```

- [ ] **Step 3: Run full test suite**

  ```bash
  npm test 2>&1 | tail -15
  ```

  Expected: all 37 tests still pass (dropbox path not yet exercised).

- [ ] **Step 4: Commit**

  ```bash
  git add src/lib/download-token.js
  git commit -m "feat(dropbox): route dropbox provider in streamDownload()"
  ```

---

## Task 5: Add Dropbox availability guard in `site.js`

**Files:**
- Modify: `src/routes/site.js`

- [ ] **Step 1: Import `isDropboxConfigured` and `getDropboxPath` in `site.js`**

  Add to existing imports:

  ```js
  import { isDropboxConfigured } from '../lib/dropbox-client.js';
  import { getDropboxPath } from '../lib/storage-metadata.js';
  ```

- [ ] **Step 2: Add dropbox guard in `/files/:slug` route**

  After the existing R2 guard block, add:

  ```js
  if (provider === 'dropbox' && (!isDropboxConfigured() || !getDropboxPath(fileItem))) {
    throw publicError(
      'Storage Dropbox chưa sẵn sàng.',
      'Dropbox storage not available.',
      locale,
      503
    );
  }
  ```

  The full guard section in `/files/:slug` should now read:

  ```js
  if (provider === 'r2' && (!isR2Enabled() || !getStorageObjectKey(fileItem))) {
    throw publicError(
      'Storage R2 chưa sẵn sàng.',
      'R2 storage not available.',
      locale,
      503
    );
  }

  if (provider === 'dropbox' && (!isDropboxConfigured() || !getDropboxPath(fileItem))) {
    throw publicError(
      'Storage Dropbox chưa sẵn sàng.',
      'Dropbox storage not available.',
      locale,
      503
    );
  }

  const absolutePath = provider === 'local' ? await resolveStoragePath(fileItem) : null;
  await streamDownload(fileItem, req, res, absolutePath);
  ```

- [ ] **Step 3: Add integration test for dropbox download route in `test/routes.test.js`**

  Add inside the `describe('routes', ...)` block:

  ```js
  describe('dropbox download', () => {
    it('streams file from Dropbox when provider is dropbox', async () => {
      const fileContent = Buffer.from('dropbox-file-content');
      const fileEntry = {
        id: 'myapp-1',
        slug: 'myapp',
        title: { vi: 'MyApp', en: 'MyApp' },
        summary: { vi: '', en: '' },
        version: '1.0.0',
        platform: 'Windows',
        sizeBytes: fileContent.length,
        mimeType: 'application/zip',
        storage: { provider: 'dropbox', dropboxPath: '/apps/dl888/myapp.zip', downloadName: 'myapp.zip' },
        storageProvider: 'dropbox',
        published: true
      };
      await fs.writeFile(indexPath, JSON.stringify([fileEntry]) + '\n', 'utf8');

      reloadConfig({
        NODE_ENV: 'development',
        DOWNLOAD_TOKEN_SECRET: 'secret',
        TURNSTILE_ENABLED: 'false',
        HCAPTCHA_ENABLED: 'false',
        DROPBOX_ENABLED: 'true',
        DROPBOX_APP_KEY: 'key',
        DROPBOX_APP_SECRET: 'secret',
        DROPBOX_REFRESH_TOKEN: 'refresh',
        FILES_INDEX_PATH: indexPath,
        FILES_STORAGE_PATH: storagePath,
        R2_ENABLED: 'false'
      });

      // Mock fetch: first call = token refresh, second call = file download
      const { Readable } = await import('node:stream');
      const bodyStream = new ReadableStream({
        start(controller) {
          controller.enqueue(fileContent);
          controller.close();
        }
      });

      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'tok-test', expires_in: 14400 })
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ 'dropbox-api-result': JSON.stringify({ name: 'myapp.zip', size: fileContent.length }) }),
          body: bodyStream
        })
      );

      vi.resetModules();
      const { issueDownloadToken: freshIssue } = await import('../src/lib/download-token.js');
      const { default: freshSiteRouter } = await import('../src/routes/site.js');

      const testApp = express();
      testApp.use(express.urlencoded({ extended: false }));
      testApp.use((req, _res, next) => {
        req.cookies = {};
        const testIp = req.headers['x-test-ip'];
        if (testIp) Object.defineProperty(req, 'ip', { value: testIp, configurable: true });
        next();
      });
      testApp.use(freshSiteRouter);

      // Issue a valid token for the file
      const token = await freshIssue(fileEntry, { ip: '1.2.3.4', get: () => 'test-agent' });

      const res = await request(testApp)
        .get(`/files/myapp?token=${encodeURIComponent(token)}`)
        .set('x-test-ip', '1.2.3.4')
        .set('user-agent', 'test-agent');

      expect(res.status).toBe(200);
      expect(res.headers['content-disposition']).toContain('myapp.zip');
      expect(res.body).toEqual(fileContent);
    });

    it('returns 503 when dropbox not configured but provider is dropbox', async () => {
      const fileEntry = {
        id: 'myapp-2',
        slug: 'myapp2',
        title: { vi: 'x', en: 'x' },
        summary: { vi: '', en: '' },
        version: '1.0.0',
        platform: 'Windows',
        sizeBytes: 100,
        mimeType: 'application/zip',
        storage: { provider: 'dropbox', dropboxPath: '/apps/dl888/x.zip', downloadName: 'x.zip' },
        storageProvider: 'dropbox',
        published: true
      };
      await fs.writeFile(indexPath, JSON.stringify([fileEntry]) + '\n', 'utf8');
      reloadConfig({
        NODE_ENV: 'development',
        DOWNLOAD_TOKEN_SECRET: 'secret',
        TURNSTILE_ENABLED: 'false',
        HCAPTCHA_ENABLED: 'false',
        DROPBOX_ENABLED: 'false',
        FILES_INDEX_PATH: indexPath,
        FILES_STORAGE_PATH: storagePath,
        R2_ENABLED: 'false'
      });
      vi.resetModules();
      const { issueDownloadToken: freshIssue } = await import('../src/lib/download-token.js');
      const { default: freshSiteRouter } = await import('../src/routes/site.js');
      const testApp = express();
      testApp.use(express.urlencoded({ extended: false }));
      testApp.use((req, _res, next) => {
        req.cookies = {};
        if (req.headers['x-test-ip']) Object.defineProperty(req, 'ip', { value: req.headers['x-test-ip'], configurable: true });
        next();
      });
      testApp.use(freshSiteRouter);
      testApp.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ ok: false, error: err.message }));

      const token = await freshIssue(fileEntry, { ip: '1.2.3.4', get: () => 'test-agent' });
      const res = await request(testApp)
        .get(`/files/myapp2?token=${encodeURIComponent(token)}`)
        .set('x-test-ip', '1.2.3.4')
        .set('user-agent', 'test-agent');

      expect(res.status).toBe(503);
    });
  });
  ```

- [ ] **Step 4: Run full test suite**

  ```bash
  npm test 2>&1 | tail -20
  ```

  Expected: all tests pass including the 2 new dropbox route tests.

- [ ] **Step 5: Commit**

  ```bash
  git add src/routes/site.js test/routes.test.js
  git commit -m "feat(dropbox): add dropbox guard in site.js and route integration tests"
  ```

---

## Task 6: Add admin API to register Dropbox files

**Files:**
- Modify: `src/routes/admin.js`

Admin needs two endpoints:
- `POST /api/admin/dropbox/link` — register a Dropbox file path into catalog (with metadata lookup)
- `GET /api/admin/dropbox/status` — check if Dropbox is configured

- [ ] **Step 1: Add import of dropbox-client in `admin.js`**

  Add to existing imports at top of file:

  ```js
  import { getDropboxMetadata, isDropboxConfigured } from '../lib/dropbox-client.js';
  ```

- [ ] **Step 2: Add routes before the legacy endpoints section (`// ── Legacy endpoints`)**

  ```js
  // ── Dropbox status ────────────────────────────────────────────────────────────

  router.get('/api/admin/dropbox/status', requireAdminSession, (_req, res) => {
    res.json({ ok: true, configured: isDropboxConfigured() });
  });

  // ── Link a Dropbox file into the catalog ──────────────────────────────────────

  router.post('/api/admin/dropbox/link', requireAdminSession, enforceJsonContentType, async (req, res, next) => {
    try {
      if (!isDropboxConfigured()) {
        return res.status(503).json({ ok: false, error: 'dropbox_not_configured' });
      }

      const { dropboxPath, downloadName, title, version, platform } = req.body || {};
      if (!dropboxPath || typeof dropboxPath !== 'string') {
        return res.status(400).json({ ok: false, error: 'dropbox_path_required' });
      }

      // Normalise: must start with /
      const normalizedPath = dropboxPath.startsWith('/') ? dropboxPath : '/' + dropboxPath;

      // Fetch metadata from Dropbox to get real size/name
      let meta = {};
      try {
        meta = await getDropboxMetadata(normalizedPath);
      } catch (err) {
        return res.status(400).json({ ok: false, error: 'dropbox_path_not_found', detail: err.message });
      }

      const resolvedDownloadName = downloadName || meta.name || path.basename(normalizedPath);
      const slug = slugify(path.basename(normalizedPath));
      const resolvedTitle = title || titleFromKey(normalizedPath);

      const catalog = await getAllFiles();
      const existing = catalog.find((e) => e?.storage?.dropboxPath === normalizedPath);

      if (existing) {
        // Update existing entry
        if (title && typeof title === 'object') existing.title = { ...existing.title, ...title };
        else if (typeof resolvedTitle === 'string') existing.title = { vi: resolvedTitle, en: resolvedTitle };
        if (version) existing.version = String(version).slice(0, 50);
        if (platform) existing.platform = String(platform).slice(0, 50);
        existing.sizeBytes = meta.size || existing.sizeBytes;
        existing.storage = { provider: 'dropbox', dropboxPath: normalizedPath, downloadName: resolvedDownloadName };
        existing.storageProvider = 'dropbox';
        existing.updatedAt = new Date().toISOString();
        await writeRawFilesIndex(catalog);
        await reloadFiles();
        return res.json({ ok: true, slug: existing.slug, updated: true });
      }

      // New entry
      catalog.push({
        id: slug + '-' + Date.now(),
        slug,
        title: typeof title === 'object' ? title : { vi: resolvedTitle, en: resolvedTitle },
        summary: { vi: '', en: '' },
        description: { vi: '', en: '' },
        version: version || '1.0.0',
        platform: platform || inferPlatform(normalizedPath),
        language: ['vi', 'en'],
        sizeBytes: meta.size || 0,
        checksumSha256: '',
        mimeType: 'application/octet-stream',
        storage: { provider: 'dropbox', dropboxPath: normalizedPath, downloadName: resolvedDownloadName },
        storageProvider: 'dropbox',
        published: false,
        featured: false,
        demo: false,
        tags: [],
        updatedAt: new Date().toISOString()
      });

      await writeRawFilesIndex(catalog);
      await reloadFiles();
      res.json({ ok: true, slug, created: true });
    } catch (err) {
      next(err);
    }
  });
  ```

- [ ] **Step 3: Run full test suite**

  ```bash
  npm test 2>&1 | tail -15
  ```

  Expected: all tests pass.

- [ ] **Step 4: Commit**

  ```bash
  git add src/routes/admin.js
  git commit -m "feat(dropbox): add admin API endpoints to link and check Dropbox files"
  ```

---

## Task 7: Push and verify

- [ ] **Step 1: Run full test suite one final time**

  ```bash
  npm test 2>&1 | tail -20
  ```

  Expected: all tests pass.

- [ ] **Step 2: Push to GitHub**

  ```bash
  git push origin main
  ```

- [ ] **Step 3: Document operator setup in `.env`**

  The operator needs to:
  1. Go to https://www.dropbox.com/developers/apps → Create app
  2. Set permissions: `files.content.read` (for download), `files.metadata.read` (for metadata)
  3. Generate a refresh token (use PKCE flow or Dropbox API explorer)
  4. Set in `.env`:
     ```
     DROPBOX_ENABLED=true
     DROPBOX_APP_KEY=<app key>
     DROPBOX_APP_SECRET=<app secret>
     DROPBOX_REFRESH_TOKEN=<refresh token>
     ```
  5. Call `POST /api/admin/dropbox/link` with body `{ "dropboxPath": "/path/in/dropbox/file.zip" }` (requires admin session cookie + CSRF header)

---

## Self-Review

### Spec coverage
- [x] Dropbox as storage provider — Task 2, 3
- [x] Server proxy (stream through app, not redirect) — `streamFromDropbox()` in Task 2
- [x] Captcha gate preserved — unchanged, `streamDownload()` is called after token verify
- [x] Config / env vars — Task 1
- [x] Admin can register Dropbox files — Task 6
- [x] Download route handles dropbox provider — Task 4, 5
- [x] 503 when Dropbox not configured — Task 5 guard + test

### Placeholder scan
- No TBDs, no "implement later", no "handle edge cases" — all steps have actual code.

### Type consistency
- `isDropboxConfigured()` — defined Task 2, imported Task 5 ✓
- `streamFromDropbox(fileItem, res)` — defined Task 2, called Task 4 ✓
- `getDropboxPath(fileItem)` — defined Task 3, imported Task 5 ✓
- `getDropboxMetadata(dropboxPath)` — defined Task 2, imported Task 6 ✓
- `storage.dropboxPath` — used consistently across Task 2, 3, 6 ✓
