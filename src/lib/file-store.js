import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { normalizeFileEntries, normalizeObjectKey } from './storage-metadata.js';

let cachedFiles = null;
let cachedFilesIndexPath = null;

async function loadFiles() {
  const raw = await fs.readFile(config.filesIndexPath, 'utf8');
  const parsed = normalizeFileEntries(JSON.parse(raw));
  cachedFilesIndexPath = config.filesIndexPath;
  cachedFiles = parsed.filter((item) => item.published);
  return cachedFiles;
}

export async function readRawFilesIndex() {
  const raw = await fs.readFile(config.filesIndexPath, 'utf8');
  const parsed = normalizeFileEntries(JSON.parse(raw));
  if (!Array.isArray(parsed)) {
    throw new Error('files.json must contain an array');
  }
  return parsed;
}

export async function writeRawFilesIndex(entries) {
  const normalizedEntries = normalizeFileEntries(entries);
  const serialized = `${JSON.stringify(normalizedEntries, null, 2)}\n`;
  await fs.writeFile(config.filesIndexPath, serialized, 'utf8');
  cachedFilesIndexPath = config.filesIndexPath;
  cachedFiles = normalizedEntries.filter((item) => item.published);
  return normalizedEntries;
}

export async function getFiles() {
  if (!cachedFiles || cachedFilesIndexPath !== config.filesIndexPath) {
    return loadFiles();
  }
  return cachedFiles;
}

export async function getAllFiles() {
  return readRawFilesIndex();
}

export async function getFileBySlug(slug) {
  const files = await getFiles();
  return files.find((item) => item.slug === slug) || null;
}

export async function resolveStoragePath(fileItem) {
  if (!fileItem?.storage?.relativePath) {
    const err = new Error('Invalid storage path');
    err.statusCode = 403;
    throw err;
  }

  const base = config.filesStoragePath.endsWith(path.sep)
    ? config.filesStoragePath
    : config.filesStoragePath + path.sep;

  const absolutePath = path.resolve(config.filesStoragePath, fileItem.storage.relativePath);

  if (!absolutePath.startsWith(base)) {
    const err = new Error('Invalid storage path');
    err.statusCode = 403;
    throw err;
  }

  await fs.access(absolutePath);
  return absolutePath;
}

async function listStorageFilesRecursive(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listStorageFilesRecursive(absolutePath));
      continue;
    }
    if (entry.isFile()) {
      files.push(absolutePath);
    }
  }

  return files;
}

function inferMimeType(relativePath) {
  const extension = path.extname(relativePath).toLowerCase();
  const types = {
    '.zip': 'application/zip',
    '.apk': 'application/vnd.android.package-archive',
    '.exe': 'application/vnd.microsoft.portable-executable',
    '.msi': 'application/x-msi',
    '.dmg': 'application/x-apple-diskimage',
    '.pkg': 'application/octet-stream',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain; charset=utf-8'
  };
  return types[extension] || 'application/octet-stream';
}

function inferPlatform(relativePath) {
  const normalized = relativePath.toLowerCase();
  if (normalized.includes('/windows/') || normalized.endsWith('.exe') || normalized.endsWith('.msi') || normalized.endsWith('.zip')) {
    if (normalized.includes('android/')) return 'Android';
    if (normalized.includes('ios/')) return 'iOS';
    if (normalized.includes('mac') || normalized.endsWith('.dmg') || normalized.endsWith('.pkg')) return 'macOS';
    return normalized.includes('windows/') ? 'Windows' : 'Generic';
  }
  if (normalized.includes('android/') || normalized.endsWith('.apk')) return 'Android';
  if (normalized.includes('ios/')) return 'iOS';
  if (normalized.includes('mac') || normalized.endsWith('.dmg') || normalized.endsWith('.pkg')) return 'macOS';
  return 'Generic';
}

function titleFromSlug(slug) {
  return slug
    .split('-')
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'file';
}

export async function sha256File(absolutePath) {
  const hash = crypto.createHash('sha256');
  const buffer = await fs.readFile(absolutePath);
  hash.update(buffer);
  return hash.digest('hex');
}

export function sanitizeRelativePath(relativePath) {
  const normalized = normalizeObjectKey(relativePath || '').trim();
  if (!normalized) {
    const err = new Error('relative_path_required');
    err.statusCode = 400;
    throw err;
  }
  if (normalized.includes('..')) {
    const err = new Error('relative_path_invalid');
    err.statusCode = 400;
    throw err;
  }
  return normalized;
}

export async function ensureStoragePath(relativePath) {
  const safeRelative = sanitizeRelativePath(relativePath);
  const base = config.filesStoragePath.endsWith(path.sep)
    ? config.filesStoragePath
    : config.filesStoragePath + path.sep;
  const absolutePath = path.resolve(config.filesStoragePath, safeRelative);

  if (!absolutePath.startsWith(base)) {
    const err = new Error('Invalid storage path');
    err.statusCode = 403;
    throw err;
  }

  return { safeRelative, absolutePath };
}

async function statStorageFile(absolutePath) {
  const relativePath = path.relative(config.filesStoragePath, absolutePath).split(path.sep).join('/');
  const stat = await fs.stat(absolutePath);
  return {
    relativePath,
    absolutePath,
    sizeBytes: stat.size,
    checksumSha256: await sha256File(absolutePath),
    mimeType: inferMimeType(relativePath),
    updatedAt: stat.mtime.toISOString(),
    slug: slugify(path.basename(relativePath))
  };
}

export async function scanStorageFiles() {
  await fs.mkdir(config.filesStoragePath, { recursive: true });
  const absoluteFiles = await listStorageFilesRecursive(config.filesStoragePath);
  const visibleFiles = absoluteFiles.filter((absolutePath) => path.basename(absolutePath) !== '.gitkeep');
  const scanned = [];

  for (const absolutePath of visibleFiles) {
    scanned.push(await statStorageFile(absolutePath));
  }

  return scanned.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function buildGeneratedEntry(scan) {
  const slug = scan.slug;
  const title = titleFromSlug(slug);
  const fileName = path.basename(scan.relativePath);

  return {
    id: slug,
    slug,
    title: { vi: title, en: title },
    summary: {
      vi: `Auto-import từ storage: ${scan.relativePath}`,
      en: `Auto-imported from storage: ${scan.relativePath}`
    },
    description: {
      vi: `Mục này được tạo tự động từ file trên đĩa (${scan.relativePath}). Hãy rà soát lại nội dung trước khi publish công khai.`,
      en: `This entry was generated automatically from a file on disk (${scan.relativePath}). Review the metadata before publishing publicly.`
    },
    version: '1.0.0',
    platform: inferPlatform(scan.relativePath),
    language: ['vi', 'en'],
    sizeBytes: scan.sizeBytes,
    checksumSha256: scan.checksumSha256,
    mimeType: scan.mimeType,
    storage: {
      provider: 'local',
      relativePath: scan.relativePath,
      downloadName: fileName
    },
    storageProvider: 'local',
    published: false,
    featured: false,
    demo: false,
    maxAllowedSizeBytes: 524288000,
    tags: ['auto-generated'],
    updatedAt: scan.updatedAt
  };
}

export function buildCatalogEntryFromScan(scan) {
  return buildGeneratedEntry(scan);
}

export async function syncFilesIndexFromDisk() {
  const currentEntries = await readRawFilesIndex();
  const scans = await scanStorageFiles();
  const byRelativePath = new Map(currentEntries.map((entry) => [entry?.storage?.relativePath, entry]));
  const updatedEntries = [...currentEntries];
  const created = [];
  const updated = [];
  const unchanged = [];

  for (const scan of scans) {
    const existing = byRelativePath.get(scan.relativePath);
    if (existing) {
      const beforeSize = existing.sizeBytes;
      const beforeChecksum = existing.checksumSha256;
      const beforeMimeType = existing.mimeType;

      existing.sizeBytes = scan.sizeBytes;
      existing.checksumSha256 = scan.checksumSha256;
      existing.mimeType = existing.mimeType || scan.mimeType;
      existing.updatedAt = scan.updatedAt;
      existing.storage = {
        ...existing.storage,
        relativePath: scan.relativePath,
        objectKey: existing.storage?.objectKey || scan.relativePath,
        r2Key: existing.storage?.r2Key || existing.storage?.objectKey || scan.relativePath,
        downloadName: existing.storage?.downloadName || path.basename(scan.relativePath)
      };

      if (beforeSize !== scan.sizeBytes || beforeChecksum !== scan.checksumSha256 || beforeMimeType !== existing.mimeType) {
        updated.push(scan.relativePath);
      } else {
        unchanged.push(scan.relativePath);
      }
      continue;
    }

    const generated = buildGeneratedEntry(scan);
    updatedEntries.push(generated);
    created.push(scan.relativePath);
  }

  updatedEntries.sort((a, b) => String(a.slug || '').localeCompare(String(b.slug || '')));
  await writeRawFilesIndex(updatedEntries);

  return {
    entries: updatedEntries,
    created,
    updated,
    unchanged,
    scanned: scans.map((scan) => ({
      relativePath: scan.relativePath,
      sizeBytes: scan.sizeBytes,
      checksumSha256: scan.checksumSha256,
      mimeType: scan.mimeType,
      updatedAt: scan.updatedAt,
      slug: scan.slug
    }))
  };
}

export async function deleteStorageFile(relativePath) {
  const { absolutePath } = await ensureStoragePath(relativePath);
  await fs.rm(absolutePath, { force: true });
  return true;
}

export async function statLocalFileByRelativePath(relativePath) {
  const { absolutePath } = await ensureStoragePath(relativePath);
  return statStorageFile(absolutePath);
}

export async function reloadFiles() {
  cachedFiles = null;
  cachedFilesIndexPath = null;
  return loadFiles();
}
