import { config } from './config.js';

const TOKEN_URL = 'https://api.dropbox.com/oauth2/token';
const DOWNLOAD_URL = 'https://content.dropboxapi.com/2/files/download';
const UPLOAD_URL = 'https://content.dropboxapi.com/2/files/upload';
const METADATA_URL = 'https://api.dropboxapi.com/2/files/get_metadata';

// In-process token cache — one access token per process lifetime
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
  // expires_in is in seconds; Dropbox tokens last ~4 hours (14400s)
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

export async function uploadToDropbox(buffer, dropboxPath, contentType = 'application/octet-stream') {
  const token = await getAccessToken();
  const resp = await fetch(UPLOAD_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': JSON.stringify({
        path: dropboxPath,
        mode: 'overwrite',
        autorename: false,
        mute: false
      }).replace(/[^\x00-\x7F]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
    },
    body: buffer,
    signal: AbortSignal.timeout(300_000)
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`dropbox_upload_failed: ${resp.status} ${text.slice(0, 300)}`);
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
        .replace(/[^\x00-\x7F]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
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
  res.setHeader('Content-Disposition', buildContentDisposition(downloadName));
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');

  // Pipe Web ReadableStream (fetch body) → Express response
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

function buildContentDisposition(filename) {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_');
  const encoded = encodeURIComponent(filename);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

// Exported for tests only
export function _resetTokenCache() {
  _cachedToken = null;
  _tokenExpiresAt = 0;
}
