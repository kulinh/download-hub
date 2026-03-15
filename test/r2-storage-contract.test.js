import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getAllFiles, writeRawFilesIndex } from '../src/lib/file-store.js';
import { buildConfig, reloadConfig } from '../src/lib/config.js';
import { getStorageDownloadName, getStorageObjectKey, normalizeFileEntry } from '../src/lib/storage-metadata.js';

describe('R2 metadata contract normalization', () => {
  let tmpDir;
  let indexPath;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'download-hub-r2-contract-'));
    indexPath = path.join(tmpDir, 'files.json');
    await fs.writeFile(indexPath, '[]\n', 'utf8');
    reloadConfig({
      NODE_ENV: 'development',
      FILES_INDEX_PATH: indexPath
    });
  });

  it('normalizes legacy r2.key-only entries into storage.objectKey for runtime lookup', async () => {
    await writeRawFilesIndex([
      {
        id: 'legacy-r2-only',
        slug: 'legacy-r2-only',
        title: { vi: 'Legacy', en: 'Legacy' },
        summary: { vi: '', en: '' },
        description: { vi: '', en: '' },
        version: '1.0.0',
        platform: 'Windows',
        language: ['vi', 'en'],
        sizeBytes: 123,
        checksumSha256: '',
        mimeType: 'application/zip',
        r2: { key: 'windows/legacy.zip', downloadName: 'legacy.zip' },
        published: true,
        featured: false,
        demo: false,
        tags: [],
        updatedAt: '2026-03-15T00:00:00Z'
      }
    ]);

    const files = await getAllFiles();
    expect(files).toHaveLength(1);
    expect(files[0].storage.objectKey).toBe('windows/legacy.zip');
    expect(files[0].storage.r2Key).toBe('windows/legacy.zip');
    expect(files[0].storage.downloadName).toBe('legacy.zip');
    expect(getStorageObjectKey(files[0])).toBe('windows/legacy.zip');
  });

  it('prefers canonical storage.objectKey when present', () => {
    const file = normalizeFileEntry({
      storage: { objectKey: 'android/app.apk', relativePath: 'android/old.apk', downloadName: 'app.apk' },
      r2: { key: 'android/outdated.apk' }
    });

    expect(getStorageObjectKey(file)).toBe('android/app.apk');
    expect(file.r2.key).toBe('android/app.apk');
    expect(getStorageDownloadName(file)).toBe('app.apk');
  });

  it('keeps public defaults neutral', () => {
    const cfg = buildConfig({});
    expect(cfg.sessionCookieName).toBe('download_hub_session');
    expect(cfg.admin.cookieName).toBe('download_hub_admin_sess');
    expect(cfg.appDisplayName).toBe('Download Hub');
  });
});
