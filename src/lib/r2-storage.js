import { GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from './config.js';
import { getStorageDownloadName, getStorageObjectKey } from './storage-metadata.js';

let _r2Client = null;

function getR2Client() {
  if (_r2Client) return _r2Client;

  if (!config.r2.accountId || !config.r2.accessKeyId || !config.r2.secretAccessKey) {
    throw new Error('R2 credentials not configured (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)');
  }

  _r2Client = new S3Client({
    region: 'auto',
    endpoint: `https://${config.r2.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.r2.accessKeyId,
      secretAccessKey: config.r2.secretAccessKey
    }
  });

  return _r2Client;
}

export async function streamFromR2(fileItem, res) {
  const client = getR2Client();
  const key = getStorageObjectKey(fileItem);

  if (!key) {
    const err = new Error('File has no R2 key configured');
    err.statusCode = 500;
    throw err;
  }

  const command = new GetObjectCommand({
    Bucket: config.r2.bucket,
    Key: key
  });

  const response = await client.send(command);

  res.setHeader('Content-Type', fileItem.mimeType || response.ContentType || 'application/octet-stream');
  if (response.ContentLength) {
    res.setHeader('Content-Length', response.ContentLength);
  }
  res.setHeader('Content-Disposition', `attachment; filename="${sanitizeFilename(getStorageDownloadName(fileItem) || key)}"`);
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');

  return new Promise((resolve, reject) => {
    const body = response.Body;
    if (!body) {
      reject(new Error('R2 response body is empty'));
      return;
    }
    body.on('error', reject);
    res.on('error', reject);
    res.on('finish', resolve);
    body.pipe(res);
  });
}

export async function getPresignedDownloadUrl(r2Key, expiresIn = 300) {
  const client = getR2Client();
  const command = new GetObjectCommand({
    Bucket: config.r2.bucket,
    Key: r2Key
  });
  return getSignedUrl(client, command, { expiresIn });
}

export async function getPresignedUploadUrl(r2Key, contentType, expiresIn = 900) {
  const client = getR2Client();
  const command = new PutObjectCommand({
    Bucket: config.r2.bucket,
    Key: r2Key,
    ContentType: contentType
  });
  return getSignedUrl(client, command, {
    expiresIn,
    signableHeaders: new Set(['content-type'])
  });
}

export async function headR2Object(r2Key) {
  const client = getR2Client();
  try {
    const command = new HeadObjectCommand({
      Bucket: config.r2.bucket,
      Key: r2Key
    });
    const response = await client.send(command);
    return {
      exists: true,
      sizeBytes: response.ContentLength || 0,
      contentType: response.ContentType || 'application/octet-stream',
      lastModified: response.LastModified?.toISOString() || null,
      etag: response.ETag || null
    };
  } catch (err) {
    if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
      return null;
    }
    throw err;
  }
}

export async function listR2Objects(prefix = '', maxKeys = 1000) {
  if (!isR2Enabled()) return [];
  const client = getR2Client();
  const command = new ListObjectsV2Command({
    Bucket: config.r2.bucket,
    Prefix: prefix || undefined,
    MaxKeys: maxKeys
  });
  const response = await client.send(command);
  return (response.Contents || []).map((obj) => ({
    key: obj.Key || '',
    sizeBytes: obj.Size || 0,
    lastModified: obj.LastModified?.toISOString() || null,
    etag: obj.ETag || null
  }));
}

export function isR2Enabled() {
  return Boolean(config.r2?.enabled && config.r2?.accountId && config.r2?.bucket);
}

function sanitizeFilename(name) {
  return String(name).replace(/[\r\n"]/g, '_');
}
