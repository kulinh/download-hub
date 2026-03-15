import { describe, expect, it } from 'vitest';
import { planR2Key, summarizeCatalogMigration } from '../src/lib/migration-tools.js';

describe('migration-tools', () => {
  it('plans R2 keys from relative paths safely', () => {
    expect(planR2Key('windows/tool.zip')).toBe('windows/tool.zip');
    expect(planR2Key('/android/app.apk')).toBe('android/app.apk');
    expect(planR2Key('\\mac\\pkg.dmg')).toBe('mac/pkg.dmg');
  });

  it('builds migration summary and upload manifest', () => {
    const catalog = [
      {
        slug: 'tool',
        sizeBytes: 10,
        checksumSha256: 'old',
        mimeType: '',
        published: true,
        demo: true,
        storage: { relativePath: 'windows/tool.zip', downloadName: 'tool.zip' }
      },
      {
        slug: 'missing',
        sizeBytes: 55,
        checksumSha256: 'missing-sha',
        published: false,
        demo: false,
        storage: { relativePath: 'android/missing.apk', downloadName: 'missing.apk' }
      }
    ];

    const disk = [
      {
        relativePath: 'windows/tool.zip',
        absolutePath: '/tmp/windows/tool.zip',
        sizeBytes: 12,
        checksumSha256: 'new',
        mimeType: 'application/zip',
        updatedAt: '2026-03-15T00:00:00.000Z'
      },
      {
        relativePath: 'extra/manual.exe',
        absolutePath: '/tmp/extra/manual.exe',
        sizeBytes: 99,
        checksumSha256: 'extra-sha',
        mimeType: 'application/octet-stream',
        updatedAt: '2026-03-15T00:00:00.000Z'
      }
    ];

    const result = summarizeCatalogMigration(catalog, disk);
    expect(result.summary.catalogEntries).toBe(2);
    expect(result.summary.scannedDiskFiles).toBe(2);
    expect(result.summary.orphanDiskFiles).toBe(1);
    expect(result.summary.missingCatalogFiles).toBe(1);
    expect(result.summary.publishedDemoEntries).toBe(1);
    expect(result.summary.metadataRefreshNeeded).toBe(1);
    expect(result.uploadManifest[0].r2Key).toBe('extra/manual.exe');
    expect(result.catalogPreview[0].r2.key).toBe('windows/tool.zip');
    expect(result.catalogPreview[0].checksumSha256).toBe('new');
  });
});
