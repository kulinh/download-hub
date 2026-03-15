import crypto from 'node:crypto';

export function formatBytes(bytes, locale = 'en') {
  if (!Number.isFinite(bytes) || bytes <= 0) return locale === 'vi' ? 'Không rõ' : 'Unknown';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = units[0];
  for (const currentUnit of units) {
    unit = currentUnit;
    if (value < 1024 || currentUnit === units.at(-1)) break;
    value /= 1024;
  }
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${unit}`;
}

export function safeEqual(a, b) {
  const bufferA = Buffer.from(String(a));
  const bufferB = Buffer.from(String(b));
  if (bufferA.length !== bufferB.length) return false;
  return crypto.timingSafeEqual(bufferA, bufferB);
}

export function createHmacToken(payload, secret) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

export function verifyHmacToken(token, secret) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [encoded, signature] = token.split('.');
  const expected = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  if (!safeEqual(signature, expected)) return null;
  try {
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

export function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || '';
}

export function buildBaseUrl(req, overrideHost) {
  const host = overrideHost || req.get('host');
  return `${req.protocol}://${host}`;
}

export function pickLocale(req, allowedLocales) {
  const queryLocale = req.query?.lang;
  if (allowedLocales.includes(queryLocale)) return queryLocale;
  const cookieLocale = req.cookies?.locale;
  if (allowedLocales.includes(cookieLocale)) return cookieLocale;
  const header = req.headers['accept-language'] || '';
  const normalized = String(header).toLowerCase();
  if (normalized.includes('vi')) return 'vi';
  return 'en';
}

export function publicError(messageVi, messageEn, locale = 'en', statusCode = 400) {
  const error = new Error(locale === 'vi' ? messageVi : messageEn);
  error.statusCode = statusCode;
  error.publicMessage = { vi: messageVi, en: messageEn };
  return error;
}

export function getServerName(req) {
  // Prefer APP_HOSTNAME if set to avoid spoofing via Host header in production
  if (process.env.APP_HOSTNAME) return process.env.APP_HOSTNAME;
  return req.get('host');
}

export function assertDownloadSecretConfigured(secret, isProd) {
  if (!isProd) return true;
  const normalized = String(secret || '').toLowerCase();
  if (!secret || normalized === 'dev-secret-change-me' || normalized === 'change-this-long-random-secret' || normalized === 'change-this') {
    const err = new Error('DOWNLOAD_TOKEN_SECRET is required and must not be a placeholder in production');
    err.statusCode = 500;
    throw err;
  }
  return true;
}
