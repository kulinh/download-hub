import { config } from './config.js';
import { listObjects, headObject, presignGetObject } from './r2-client.js';
import { formatBytes } from './utils.js';

export async function listR2Objects(prefix = '') {
  await ensureEnabled();
  const result = await listObjects(prefix);
  return result.objects.map((obj) => ({
    key: obj.key,
    sizeBytes: obj.size,
    displaySize: formatBytes(obj.size, 'vi'),
    etag: obj.etag,
    lastModified: obj.lastModified,
    storageClass: obj.storageClass
  }));
}

export async function getR2ObjectMeta(key) {
  await ensureEnabled();
  const head = await headObject(key);
  return head;
}

export async function getR2PresignedUrl(key, expiresInSeconds = 300) {
  await ensureEnabled();
  return presignGetObject(key, expiresInSeconds);
}

async function ensureEnabled() {
  if (!config.r2.enabled) {
    const err = new Error('Cloudflare R2 not enabled');
    err.statusCode = 500;
    throw err;
  }
  if (!config.r2.bucket || !config.r2.accountId) {
    const err = new Error('Cloudflare R2 misconfigured');
    err.statusCode = 500;
    throw err;
  }
}
