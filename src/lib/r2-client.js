/**
 * r2-client.js — Cloudflare R2 S3-compatible client
 * Uses the AWS S3 SDK v3 if available, or falls back to direct fetch with
 * manual AWS Signature v4 for minimal dependency footprint.
 *
 * Exports:
 *   isR2Configured()     — bool: are all required env vars set?
 *   listR2Objects()      — list all objects in bucket
 *   deleteR2Object(key)  — delete an object by key
 *   getPresignedUploadUrl(key, contentType, ttlSeconds)
 *   getPresignedDownloadUrl(key, ttlSeconds, downloadName)
 */
import crypto from 'node:crypto';
import { config } from './config.js';

export function isR2Configured() {
  // Support both structured config.r2.* (primary) and legacy flat fields
  return Boolean(
    (config.r2?.accountId || config.r2AccountId) &&
    (config.r2?.accessKeyId || config.r2AccessKeyId) &&
    (config.r2?.secretAccessKey || config.r2SecretAccessKey) &&
    (config.r2?.bucket || config.r2BucketName)
  );
}

function r2Endpoint() {
  return `https://${config.r2?.accountId || config.r2AccountId}.r2.cloudflarestorage.com`;
}

function r2BucketUrl() {
  return `${r2Endpoint()}/${config.r2?.bucket || config.r2BucketName}`;
}

// ── AWS Signature v4 helpers ────────────────────────────────────────────────

function hmacSha256(key, data) {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

function getSigningKey(secretKey, dateStamp, region, service) {
  const kDate    = hmacSha256('AWS4' + secretKey, dateStamp);
  const kRegion  = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  const kSigning = hmacSha256(kService, 'aws4_request');
  return kSigning;
}

function isoDate(d = new Date()) {
  return d.toISOString().replace(/[:\-]|\.\d{3}/g, '').slice(0, 15) + 'Z';
}

function dateStamp(d = new Date()) {
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

function signedHeaders(headers) {
  return Object.keys(headers).map((k) => k.toLowerCase()).sort().join(';');
}

function canonicalHeaders(headers) {
  return Object.keys(headers)
    .map((k) => k.toLowerCase())
    .sort()
    .map((k) => k + ':' + headers[k].trim())
    .join('\n') + '\n';
}

/**
 * Generate a presigned URL (GET or PUT) using manual AWS Signature V4 Query.
 */
function buildPresignedUrl({ method, key, ttlSeconds = 120, extraHeaders = {}, responseDisposition }) {
  const region = 'auto';
  const service = 's3';
  const now = new Date();
  const amzDate = isoDate(now);
  const ds = dateStamp(now);
  const host = `${config.r2AccountId}.r2.cloudflarestorage.com`;
  const path = `/${config.r2BucketName}/${encodeURIComponent(key).replace(/%2F/g, '/')}`;

  const credentialScope = `${ds}/${region}/${service}/aws4_request`;
  const credential = `${config.r2AccessKeyId}/${credentialScope}`;

  const queryParams = new URLSearchParams({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': credential,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(ttlSeconds),
    'X-Amz-SignedHeaders': 'host'
  });

  if (responseDisposition) {
    queryParams.set('response-content-disposition', responseDisposition);
  }

  // Sort canonical query
  const sortedQuery = Array.from(queryParams.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v))
    .join('&');

  const canonicalReq = [
    method,
    path,
    sortedQuery,
    `host:${host}\n`,
    'host',
    'UNSIGNED-PAYLOAD'
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalReq)
  ].join('\n');

  const signingKey = getSigningKey(config.r2SecretAccessKey, ds, region, service);
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  return `https://${host}${path}?${sortedQuery}&X-Amz-Signature=${signature}`;
}

export function getPresignedUploadUrl(key, contentType = 'application/octet-stream', ttlSeconds) {
  if (!isR2Configured()) throw new Error('r2_not_configured');
  return buildPresignedUrl({
    method: 'PUT',
    key,
    ttlSeconds: ttlSeconds || config.r2PresignedTtlSeconds || 120
  });
}

export function getPresignedDownloadUrl(key, ttlSeconds, downloadName) {
  if (!isR2Configured()) throw new Error('r2_not_configured');
  const disposition = downloadName
    ? `attachment; filename="${downloadName.replace(/["\n\r]/g, '')}"`
    : undefined;
  return buildPresignedUrl({
    method: 'GET',
    key,
    ttlSeconds: ttlSeconds || config.r2PresignedTtlSeconds || 120,
    responseDisposition: disposition
  });
}

/**
 * List objects in the R2 bucket using S3 ListObjectsV2 API.
 */
export async function listR2Objects(prefix = '', maxKeys = 1000) {
  if (!isR2Configured()) return [];

  const region = 'auto';
  const service = 's3';
  const now = new Date();
  const amzDate = isoDate(now);
  const ds = dateStamp(now);
  const host = `${config.r2AccountId}.r2.cloudflarestorage.com`;

  const queryParams = new URLSearchParams({ 'list-type': '2', 'max-keys': String(maxKeys) });
  if (prefix) queryParams.set('prefix', prefix);
  const queryString = queryParams.toString();

  const canonicalReq = [
    'GET',
    `/${config.r2BucketName}/`,
    queryString,
    `host:${host}\nx-amz-content-sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855\nx-amz-date:${amzDate}\n`,
    'host;x-amz-content-sha256;x-amz-date',
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  ].join('\n');

  const credentialScope = `${ds}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalReq)
  ].join('\n');

  const signingKey = getSigningKey(config.r2SecretAccessKey, ds, region, service);
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  const authHeader = `AWS4-HMAC-SHA256 Credential=${config.r2AccessKeyId}/${credentialScope}, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=${signature}`;

  const url = `https://${host}/${config.r2BucketName}/?${queryString}`;
  const resp = await fetch(url, {
    headers: {
      host,
      'x-amz-date': amzDate,
      'x-amz-content-sha256': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      'Authorization': authHeader
    },
    signal: AbortSignal.timeout(15000)
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`r2_list_failed: ${resp.status} ${body.slice(0, 200)}`);
  }

  const xml = await resp.text();
  const objects = [];
  const regex = /<Contents>([\s\S]*?)<\/Contents>/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    const content = match[1];
    const key = content.match(/<Key>([\s\S]*?)<\/Key>/)?.[1] || '';
    const size = parseInt(content.match(/<Size>(\d+)<\/Size>/)?.[1] || '0', 10);
    const modified = content.match(/<LastModified>([\s\S]*?)<\/LastModified>/)?.[1] || '';
    objects.push({ key, sizeBytes: size, lastModified: modified });
  }

  return objects;
}

/**
 * Delete an object from R2 bucket.
 */
export async function deleteR2Object(key) {
  if (!isR2Configured()) throw new Error('r2_not_configured');

  const region = 'auto';
  const service = 's3';
  const now = new Date();
  const amzDate = isoDate(now);
  const ds = dateStamp(now);
  const host = `${config.r2AccountId}.r2.cloudflarestorage.com`;
  const path = `/${config.r2BucketName}/${encodeURIComponent(key).replace(/%2F/g, '/')}`;
  const emptyHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

  const canonicalReq = [
    'DELETE',
    path,
    '',
    `host:${host}\nx-amz-content-sha256:${emptyHash}\nx-amz-date:${amzDate}\n`,
    'host;x-amz-content-sha256;x-amz-date',
    emptyHash
  ].join('\n');

  const credentialScope = `${ds}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalReq)
  ].join('\n');

  const signingKey = getSigningKey(config.r2SecretAccessKey, ds, region, service);
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  const authHeader = `AWS4-HMAC-SHA256 Credential=${config.r2AccessKeyId}/${credentialScope}, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=${signature}`;

  const resp = await fetch(`https://${host}${path}`, {
    method: 'DELETE',
    headers: {
      host,
      'x-amz-date': amzDate,
      'x-amz-content-sha256': emptyHash,
      'Authorization': authHeader
    },
    signal: AbortSignal.timeout(15000)
  });

  if (!resp.ok && resp.status !== 204) {
    const body = await resp.text().catch(() => '');
    throw new Error(`r2_delete_failed: ${resp.status} ${body.slice(0, 200)}`);
  }

  return true;
}
