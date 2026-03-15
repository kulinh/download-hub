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
      ? '/home/cloudpanel/htdocs/download-888vn/storage/files'
      : './storage/files');

  const cfg = {
    rootDir,
    port: toInt(env.PORT, 3000),
    nodeEnv: env.NODE_ENV || 'development',
    appBaseUrl: env.APP_BASE_URL || 'http://localhost:3000',
    appHostname: env.APP_HOSTNAME || 'localhost',
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    downloadTokenSecret: env.DOWNLOAD_TOKEN_SECRET || 'dev-secret-change-me',
    sessionCookieName: env.SESSION_COOKIE_NAME || 'dl888_session',
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
    useXAccelRedirect: toBool(env.USE_X_ACCEL_REDIRECT, false),
    xAccelInternalPrefix: env.X_ACCEL_INTERNAL_PREFIX || '/protected-downloads',
    rateLimitWindowSeconds: toInt(env.RATE_LIMIT_WINDOW_SECONDS, 300),
    rateLimitMaxAttempts: toInt(env.RATE_LIMIT_MAX_ATTEMPTS, 20),
    logRequests: toBool(env.LOG_REQUESTS, false),
    // Admin reload token — leave blank to disable /api/admin/reload
    adminBearerToken: env.ADMIN_BEARER_TOKEN || ''
  };

  cfg.captchaProvider = detectCaptchaProvider(cfg);

  if (cfg.nodeEnv === 'production') {
    if (!cfg.downloadTokenSecret || isPlaceholderSecret(cfg.downloadTokenSecret)) {
      throw new Error('DOWNLOAD_TOKEN_SECRET is required and must not be a placeholder in production');
    }
    if (!cfg.captchaProvider) {
      throw new Error('Captcha provider (TURNSTILE or HCAPTCHA) must be configured in production');
    }
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
