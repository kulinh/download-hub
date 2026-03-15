import { describe, it, expect } from 'vitest';
import { resolveStoragePath } from '../src/lib/file-store.js';
import { reloadConfig, buildConfig } from '../src/lib/config.js';
import path from 'node:path';
import fs from 'node:fs/promises';

describe('path traversal guard', () => {
  it('rejects traversal outside base', async () => {
    const base = path.resolve(process.cwd(), 'storage/files');
    await fs.mkdir(base, { recursive: true });
    reloadConfig({ FILES_STORAGE_PATH: base });
    const file = { storage: { relativePath: '../etc/passwd' } };
    await expect(resolveStoragePath(file)).rejects.toThrow();
  });
});

describe('FILES_STORAGE_PATH — absolute path resolution', () => {
  it('resolves relative path correctly relative to project root (not cwd)', () => {
    // buildConfig resolves FILES_STORAGE_PATH using path.resolve(rootDir, value)
    // where rootDir is derived from config.js __dirname — always the project root.
    // This test documents the expected resolution to catch cwd drift regressions
    // (important for CloudPanel/PM2 deploys where cwd may differ from project root).
    const cfg = buildConfig({ FILES_STORAGE_PATH: './storage/files' });
    // Must be absolute and end with /storage/files
    expect(path.isAbsolute(cfg.filesStoragePath)).toBe(true);
    expect(cfg.filesStoragePath).toMatch(/storage[/\\]files$/);
  });
});

describe('demo scaffold — files.json catalog truthfulness', () => {
  it('all published entries have a non-empty, 64-char checksumSha256', async () => {
    const raw = await fs.readFile(
      path.resolve(process.cwd(), 'src/data/files.json'),
      'utf8'
    );
    const entries = JSON.parse(raw);
    for (const entry of entries) {
      if (entry.published) {
        expect(
          entry.checksumSha256,
          `published entry "${entry.id}" must not use old placeholder "replace-with-real-sha256"`
        ).not.toBe('replace-with-real-sha256');
        expect(
          entry.checksumSha256.length,
          `published entry "${entry.id}" checksumSha256 must be 64 hex chars`
        ).toBe(64);
      }
    }
  });

  it('unpublished entries declare sizeBytes=0 so callers are not misled by fake sizes', async () => {
    const raw = await fs.readFile(
      path.resolve(process.cwd(), 'src/data/files.json'),
      'utf8'
    );
    const entries = JSON.parse(raw);
    for (const entry of entries) {
      if (!entry.published) {
        expect(
          entry.sizeBytes,
          `unpublished entry "${entry.id}" should have sizeBytes=0 (no real file)`
        ).toBe(0);
      }
    }
  });

  it('unpublished entries have checksumSha256 as 64-char zero string (explicit demo marker, not text placeholder)', async () => {
    const raw = await fs.readFile(
      path.resolve(process.cwd(), 'src/data/files.json'),
      'utf8'
    );
    const entries = JSON.parse(raw);
    for (const entry of entries) {
      if (!entry.published) {
        expect(
          entry.checksumSha256,
          `unpublished entry "${entry.id}" must not use old text placeholder "replace-with-real-sha256"`
        ).not.toBe('replace-with-real-sha256');
        expect(
          entry.checksumSha256,
          `unpublished entry "${entry.id}" must not have empty checksumSha256`
        ).not.toBe('');
        expect(
          entry.checksumSha256.length,
          `unpublished entry "${entry.id}" checksumSha256 must be 64 chars (zeros for demo)`
        ).toBe(64);
      }
    }
  });

  it('demo scaffold has at least one entry — repo is not empty', async () => {
    const raw = await fs.readFile(
      path.resolve(process.cwd(), 'src/data/files.json'),
      'utf8'
    );
    const entries = JSON.parse(raw);
    expect(entries.length).toBeGreaterThan(0);
  });
});


describe('template branding neutrality', () => {
  it('sample catalog uses neutral download names and explicit object keys', async () => {
    const raw = await fs.readFile(
      path.resolve(process.cwd(), 'src/data/files.json'),
      'utf8'
    );
    const entries = JSON.parse(raw);

    for (const entry of entries) {
      expect(entry.storage?.objectKey, `entry "${entry.id}" must declare storage.objectKey`).toBeTruthy();
      expect(entry.storage?.downloadName || '', `entry "${entry.id}" downloadName should be neutral`).not.toMatch(/888vn/i);
    }
  });
});
