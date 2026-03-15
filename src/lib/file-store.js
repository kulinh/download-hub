import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

let cachedFiles = null;

async function loadFiles() {
  const raw = await fs.readFile(config.filesIndexPath, 'utf8');
  const parsed = JSON.parse(raw);
  cachedFiles = parsed.filter((item) => item.published);
  return cachedFiles;
}

export async function getFiles() {
  return cachedFiles || loadFiles();
}

export async function getFileBySlug(slug) {
  const files = await getFiles();
  return files.find((item) => item.slug === slug) || null;
}

/**
 * Resolves and validates an absolute storage path for a file item.
 *
 * Security: uses a normalised base path with a trailing separator to prevent
 * prefix-confusion attacks (e.g. /storage/files_other would NOT match
 * /storage/files/ even though the shorter string is a prefix of it).
 */
export async function resolveStoragePath(fileItem) {
  if (!fileItem?.storage?.relativePath) {
    const err = new Error('Invalid storage path');
    err.statusCode = 403;
    throw err;
  }

  // Normalise base to always end with sep so startsWith is unambiguous
  const base = config.filesStoragePath.endsWith(path.sep)
    ? config.filesStoragePath
    : config.filesStoragePath + path.sep;

  const absolutePath = path.resolve(config.filesStoragePath, fileItem.storage.relativePath);

  // Must start with the normalised base (directory separator prevents false matches)
  if (!absolutePath.startsWith(base)) {
    const err = new Error('Invalid storage path');
    err.statusCode = 403;
    throw err;
  }

  await fs.access(absolutePath);
  return absolutePath;
}

/**
 * Force-reload the files index (useful after SFTP updates without full restart).
 * Exposed for /api/admin/reload (protected by bearer token if configured).
 */
export async function reloadFiles() {
  cachedFiles = null;
  return loadFiles();
}
