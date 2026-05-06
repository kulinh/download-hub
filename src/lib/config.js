import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

function toBool(value, fallback = false) {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function toInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBytes(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const num = Number(value);
  if (Number.isFinite(num)) return num;
  const match = String(value).trim().toLowerCase().match(/^(\d+)(kb|mb|gb)?$/);
  if (!match) return fallback;
  const size = Number.parseInt(match[1], 10);
  const unit = match[2];
  if (unit === 'kb') return size * 1024;
  if (unit === 'mb') return size * 1024 * 1024;
  if (unit === 'gb') return size * 1024 * 1024 * 1024;
  return size;
}

function parseTrustProxy(value) {
  if (value === undefined || value === '') return 'loopback';
  const normalized = String(value).toLowerCase().trim();
  if (['false', '0', 'off', 'no'].includes(normalized)) return false;
  if (['true', '1', 'yes', 'on'].includes(normalized)) return 'loopback';
  const parts = normalized.split(',').map((item) => item.trim()).filter(Boolean);
  return parts.length === 1 ? parts[0] : parts;
}

function detectCaptchaProvider(cfg) {
  const hasTurnstile = cfg.turnstile.enabled && cfg.turnstile.siteKey && cfg.turnstile.secretKey;
  const hasHcaptcha = cfg.hcaptcha.enabled && cfg.hcaptcha.siteKey && cfg.hcaptcha.secretKey;
  if (hasTurnstile) return 'turnstile';
  if (hasHcaptcha) return 'hcaptcha';
  return null;
}

function isPlaceholderSecret(secret) {
  const normalized = String(secret || '').toLowerCase();
  return normalized === 'dev-secret-change-me' || normalized === 'change-this-long-random-secret' || normalized === 'change-this';
}

export function buildConfig(env = process.env) {
  const storagePathRaw = env.FILES_STORAGE_PATH
    || (env.NODE_ENV === 'production'
      ? '/app/storage/files'
      : './storage/files');

  const cfg = {
    rootDir,
    port: toInt(env.PORT, 3000),
    nodeEnv: env.NODE_ENV || 'development',
    appBaseUrl: env.APP_BASE_URL || 'http://localhost:3000',
    appHostname: env.APP_HOSTNAME || 'localhost',
    appDisplayName: env.APP_DISPLAY_NAME || 'Download Hub',
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    downloadTokenSecret: env.DOWNLOAD_TOKEN_SECRET || 'dev-secret-change-me',
    sessionCookieName: env.SESSION_COOKIE_NAME || 'download_hub_session',
    sessionTtlSeconds: toInt(env.SESSION_TTL_SECONDS, 1200),
    downloadTokenTtlSeconds: toInt(env.DOWNLOAD_TOKEN_TTL_SECONDS, 120),
    maxBodySize: env.MAX_BODY_SIZE || '20kb',
    allowedLocales: (env.ALLOWED_LOCALES || 'vi,en').split(',').map((item) => item.trim()).filter(Boolean),
    filesIndexPath: path.resolve(rootDir, env.FILES_INDEX_PATH || './src/data/files.json'),
    filesStoragePath: path.isAbsolute(storagePathRaw)
      ? storagePathRaw
      : path.resolve(rootDir, storagePathRaw),
    turnstile: {
      enabled: toBool(env.TURNSTILE_ENABLED, true),
      siteKey: env.TURNSTILE_SITE_KEY || '',
      secretKey: env.TURNSTILE_SECRET_KEY || '',
      action: env.TURNSTILE_ACTION || 'download_gate'
    },
    hcaptcha: {
      enabled: toBool(env.HCAPTCHA_ENABLED, false),
      siteKey: env.HCAPTCHA_SITE_KEY || '',
      secretKey: env.HCAPTCHA_SECRET_KEY || '',
      expectedHostname: env.HCAPTCHA_EXPECTED_HOSTNAME || env.APP_HOSTNAME || 'localhost'
    },
    admin: {
      username: env.ADMIN_USERNAME || '',
      password: env.ADMIN_PASSWORD || '',
      sessionSecret: env.ADMIN_SESSION_SECRET || env.DOWNLOAD_TOKEN_SECRET || 'dev-secret-change-me',
      sessionTtlSeconds: toInt(env.ADMIN_SESSION_TTL_SECONDS, 3600),
      cookieName: env.ADMIN_COOKIE_NAME || 'download_hub_admin_sess'
    },
    r2: {
      enabled: toBool(env.R2_ENABLED, false),
      accountId: env.R2_ACCOUNT_ID || '',
      accessKeyId: env.R2_ACCESS_KEY_ID || '',
      secretAccessKey: env.R2_SECRET_ACCESS_KEY || '',
      bucket: env.R2_BUCKET || ''
    },
    dropbox: {
      enabled: toBool(env.DROPBOX_ENABLED, false),
      appKey: env.DROPBOX_APP_KEY || '',
      appSecret: env.DROPBOX_APP_SECRET || '',
      refreshToken: env.DROPBOX_REFRESH_TOKEN || ''
    },
    localUploadMaxBytes: toBytes(env.LOCAL_UPLOAD_MAX_BYTES, 512 * 1024 * 1024),
    useXAccelRedirect: toBool(env.USE_X_ACCEL_REDIRECT, false),
    xAccelInternalPrefix: env.X_ACCEL_INTERNAL_PREFIX || '/protected-downloads',
    rateLimitWindowSeconds: toInt(env.RATE_LIMIT_WINDOW_SECONDS, 300),
    rateLimitMaxAttempts: toInt(env.RATE_LIMIT_MAX_ATTEMPTS, 20),
    logRequests: toBool(env.LOG_REQUESTS, false),
    adminBearerToken: env.ADMIN_BEARER_TOKEN || '',
    localStorageEnabled: toBool(env.LOCAL_STORAGE_ENABLED, true)
  };

  cfg.captchaProvider = detectCaptchaProvider(cfg);

  cfg.dropbox = {
    ...cfg.dropbox,
    enabled: cfg.dropbox.enabled && Boolean(cfg.dropbox.appKey && cfg.dropbox.appSecret && cfg.dropbox.refreshToken)
  };

  const hasR2Creds = cfg.r2.accountId && cfg.r2.accessKeyId && cfg.r2.secretAccessKey && cfg.r2.bucket;
  // Harden enabled flag: only true if creds present
  cfg.r2.enabled = Boolean(cfg.r2.enabled && hasR2Creds);

  const hasLocalStorage = Boolean(cfg.filesStoragePath && cfg.localStorageEnabled !== false);
  cfg.storageProviders = {
    r2: cfg.r2.enabled,
    local: hasLocalStorage
  };

  if (cfg.nodeEnv === 'production') {
    if (!cfg.downloadTokenSecret || isPlaceholderSecret(cfg.downloadTokenSecret)) {
      throw new Error('DOWNLOAD_TOKEN_SECRET is required and must not be a placeholder in production');
    }
    if (!cfg.admin.sessionSecret || isPlaceholderSecret(cfg.admin.sessionSecret)) {
      throw new Error('ADMIN_SESSION_SECRET is required and must not be a placeholder in production');
    }
    if (!cfg.turnstile.enabled || !cfg.turnstile.siteKey || !cfg.turnstile.secretKey) {
      throw new Error('Cloudflare Turnstile (TURNSTILE_ENABLED, TURNSTILE_SITE_KEY, TURNSTILE_SECRET_KEY) must be configured in production');
    }
    if (!cfg.hcaptcha.enabled || !cfg.hcaptcha.siteKey || !cfg.hcaptcha.secretKey) {
      throw new Error('hCaptcha (HCAPTCHA_ENABLED, HCAPTCHA_SITE_KEY, HCAPTCHA_SECRET_KEY) must be configured in production for admin panel');
    }
    if (!cfg.admin.username || !cfg.admin.password) {
      throw new Error('ADMIN_USERNAME and ADMIN_PASSWORD must be set in production');
    }
    if (cfg.r2.enabled) {
      if (!hasR2Creds) {
        throw new Error('Cloudflare R2 (R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY) must be fully configured when R2_ENABLED=true');
      }
    } else if (!hasLocalStorage) {
      throw new Error('Either R2 must be configured or local storage path must be available in production');
    }
    cfg.adminBearerToken = '';
  }

  return cfg;
}

export let config = buildConfig();

export function reloadConfig(env = process.env) {
  const nextConfig = buildConfig(env);
  config = nextConfig;
  return config;
}

export function isProduction() {
  return config.nodeEnv === 'production';
}
