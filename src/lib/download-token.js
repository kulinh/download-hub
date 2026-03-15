import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { isR2Enabled, streamFromR2 } from './r2-storage.js';
import { getStorageDownloadName, getStorageObjectKey } from './storage-metadata.js';
import { createHmacToken, verifyHmacToken } from './utils.js';

function hmacDigest(value) {
  return crypto.createHmac('sha256', config.downloadTokenSecret)
    .update(String(value))
    .digest('base64url')
    .slice(0, 32);
}

export async function issueDownloadToken(fileItem, req) {
  const expiresAt = Date.now() + (config.downloadTokenTtlSeconds * 1000);
  const payload = {
    slug: fileItem.slug,
    exp: expiresAt,
    ipHash: hmacDigest(req.ip || ''),
    uaHash: hmacDigest(req.get('user-agent') || '')
  };
  return createHmacToken(payload, config.downloadTokenSecret);
}

export function verifyDownloadToken(token, req) {
  const payload = verifyHmacToken(token, config.downloadTokenSecret);
  if (!payload) return { valid: false, reason: 'invalid_signature' };
  if (!payload.exp || Date.now() > payload.exp) return { valid: false, reason: 'expired' };
  if (payload.ipHash !== hmacDigest(req.ip || '')) return { valid: false, reason: 'ip_mismatch' };
  if (payload.uaHash !== hmacDigest(req.get('user-agent') || '')) return { valid: false, reason: 'ua_mismatch' };
  return { valid: true, payload };
}

export async function streamDownload(fileItem, req, res, absolutePath) {
  if (isR2Enabled() && getStorageObjectKey(fileItem)) {
    return streamFromR2(fileItem, res);
  }

  const stat = await fs.stat(absolutePath);
  res.setHeader('Content-Type', fileItem.mimeType || 'application/octet-stream');
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Content-Disposition', `attachment; filename="${sanitizeFilename(getStorageDownloadName(fileItem))}"`);
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');

  if (config.useXAccelRedirect) {
    const internalPath = path.posix.join(
      config.xAccelInternalPrefix,
      fileItem.storage.relativePath.split(path.sep).join('/')
    );
    res.setHeader('X-Accel-Redirect', internalPath);
    return res.status(200).end();
  }

  return res.sendFile(absolutePath);
}

function sanitizeFilename(name) {
  return String(name).replace(/[\r\n"]/g, '_');
}
