import express from 'express';
import { getCaptchaProviderConfig, getHcaptchaConfig, verifyHcaptchaToken, verifyTurnstileToken } from '../lib/captcha.js';
import {
  getAllFiles,
  getFileBySlug,
  getFiles,
  reloadFiles,
  resolveStoragePath,
  scanStorageFiles,
  syncFilesIndexFromDisk
} from '../lib/file-store.js';
import { config } from '../lib/config.js';
import { issueDownloadToken, streamDownload, verifyDownloadToken } from '../lib/download-token.js';
import { t } from '../lib/i18n.js';
import { buildBaseUrl, formatBytes, getServerName, pickLocale, publicError } from '../lib/utils.js';
import { simpleRateLimit } from '../middleware/rate-limit.js';
import { enforceFormContentType, requireAdminToken } from '../middleware/security.js';
import {
  clearAdminSession,
  issueAdminSession,
  requireAdminSession,
  requireAdminSessionPage,
  validateAdminCredentials
} from '../middleware/admin-auth.js';
import { getPresignedUploadUrl, headR2Object, isR2Enabled, listR2Objects } from '../lib/r2-storage.js';

const router = express.Router();

function pageData(req) {
  const locale = pickLocale(req, config.allowedLocales);
  return { locale, t: (key) => t(locale, key) };
}

function attachDisplaySize(item, locale) {
  return {
    ...item,
    displaySize: formatBytes(item.sizeBytes, locale)
  };
}

// ── Health check ─────────────────────────────────────────────────────────────

router.get('/health', (_req, res) => {
  res.json({ ok: true, uptime: Math.floor(process.uptime()) });
});

// ── Admin: Login page ─────────────────────────────────────────────────────────

router.get('/admin/login', (req, res) => {
  const { locale, t: translate } = pageData(req);
  const hcaptcha = getHcaptchaConfig();
  res.render('admin-login', {
    locale,
    t: translate,
    hcaptcha,
    cspNonce: res.locals.cspNonce,
    error: null
  });
});

router.post('/admin/login', enforceFormContentType, simpleRateLimit, async (req, res, next) => {
  try {
    const { locale, t: translate } = pageData(req);
    const hcaptcha = getHcaptchaConfig();
    const { username, password } = req.body || {};

    const renderLogin = (error) => res.status(401).render('admin-login', {
      locale,
      t: translate,
      hcaptcha,
      cspNonce: res.locals.cspNonce,
      error
    });

    // 1. Verify hCaptcha
    const captcha = await verifyHcaptchaToken(req);
    if (!captcha.success) {
      return renderLogin(locale === 'vi' ? 'Xác minh captcha thất bại.' : 'Captcha verification failed.');
    }

    // 2. Validate credentials
    if (!validateAdminCredentials(username, password)) {
      return renderLogin(locale === 'vi' ? 'Tên đăng nhập hoặc mật khẩu không đúng.' : 'Invalid username or password.');
    }

    // 3. Issue session
    issueAdminSession(res);
    res.redirect(302, '/admin');
  } catch (error) {
    next(error);
  }
});

router.post('/admin/logout', (req, res) => {
  clearAdminSession(res);
  res.redirect(302, '/admin/login');
});

// ── Admin UI (requires session) ───────────────────────────────────────────────

router.get('/admin', requireAdminSessionPage, async (req, res, next) => {
  try {
    const { locale, t: translate } = pageData(req);
    res.render('admin', {
      locale,
      t: translate,
      r2Enabled: isR2Enabled(),
      cspNonce: res.locals.cspNonce
    });
  } catch (error) {
    next(error);
  }
});

// ── Admin APIs (require session) ──────────────────────────────────────────────

router.get('/api/admin/files', requireAdminSession, async (req, res, next) => {
  try {
    const [entries, scanned] = await Promise.all([
      getAllFiles(),
      scanStorageFiles()
    ]);

    const scannedByPath = new Map(scanned.map((item) => [item.relativePath, item]));
    const files = entries.map((entry) => {
      const disk = scannedByPath.get(entry?.storage?.relativePath);
      return {
        ...entry,
        disk: disk ? {
          exists: true,
          sizeBytes: disk.sizeBytes,
          checksumSha256: disk.checksumSha256,
          mimeType: disk.mimeType,
          updatedAt: disk.updatedAt,
          slug: disk.slug
        } : {
          exists: false,
          sizeBytes: null,
          checksumSha256: null,
          mimeType: null,
          updatedAt: null,
          slug: null
        }
      };
    });

    const extraDiskFiles = scanned
      .filter((item) => !entries.some((entry) => entry?.storage?.relativePath === item.relativePath))
      .map((item) => ({
        relativePath: item.relativePath,
        sizeBytes: item.sizeBytes,
        checksumSha256: item.checksumSha256,
        mimeType: item.mimeType,
        updatedAt: item.updatedAt,
        slug: item.slug
      }));

    // R2 inventory preview (optional)
    let r2Objects = [];
    if (isR2Enabled()) {
      try {
        r2Objects = await listR2Objects();
      } catch (err) {
        r2Objects = [{ error: err.message }];
      }
    }

    res.json({
      ok: true,
      files,
      extraDiskFiles,
      storagePath: config.filesStoragePath,
      filesIndexPath: config.filesIndexPath,
      r2: {
        enabled: isR2Enabled(),
        bucket: config.r2.bucket,
        accountId: config.r2.accountId,
        objects: r2Objects
      }
    });
  } catch (error) {
    next(error);
  }
});

router.post('/api/admin/sync', requireAdminSession, async (req, res, next) => {
  try {
    const result = await syncFilesIndexFromDisk();
    res.json({
      ok: true,
      created: result.created,
      updated: result.updated,
      unchanged: result.unchanged,
      scanned: result.scanned,
      totalEntries: result.entries.length
    });
  } catch (error) {
    next(error);
  }
});

router.post('/api/admin/reload', requireAdminSession, async (req, res, next) => {
  try {
    const files = await reloadFiles();
    res.json({ ok: true, count: files.length });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/admin/r2/presign-upload
 * Generate a presigned PUT URL for direct-to-R2 upload from admin panel.
 * Query params: key (R2 object key), contentType
 */
router.get('/api/admin/r2/presign-upload', requireAdminSession, async (req, res, next) => {
  try {
    if (!isR2Enabled()) {
      return res.status(400).json({ ok: false, error: 'r2_not_enabled' });
    }
    const { key, contentType } = req.query;
    if (!key || typeof key !== 'string' || key.trim() === '') {
      return res.status(400).json({ ok: false, error: 'key_required' });
    }
    const mimeType = typeof contentType === 'string' && contentType.trim()
      ? contentType.trim()
      : 'application/octet-stream';

    const url = await getPresignedUploadUrl(key.trim(), mimeType);
    res.json({ ok: true, url, key: key.trim(), expiresIn: 900 });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/admin/r2/head
 * Check R2 object existence and metadata.
 * Query params: key
 */
router.get('/api/admin/r2/head', requireAdminSession, async (req, res, next) => {
  try {
    if (!isR2Enabled()) {
      return res.status(400).json({ ok: false, error: 'r2_not_enabled' });
    }
    const { key } = req.query;
    if (!key || typeof key !== 'string') {
      return res.status(400).json({ ok: false, error: 'key_required' });
    }
    const meta = await headR2Object(key.trim());
    if (!meta) {
      return res.status(404).json({ ok: false, exists: false, error: 'not_found' });
    }
    res.json({ ok: true, exists: true, ...meta });
  } catch (error) {
    next(error);
  }
});

// ── Legacy: bearer token reload (backward compat) ────────────────────────────
// Kept for CI/CD pipelines that already use ADMIN_BEARER_TOKEN

router.post('/api/admin/reload-legacy', requireAdminToken, async (req, res, next) => {
  try {
    const files = await reloadFiles();
    res.json({ ok: true, count: files.length });
  } catch (error) {
    next(error);
  }
});

// ── Public pages ──────────────────────────────────────────────────────────────

router.get('/', async (req, res, next) => {
  try {
    const { locale, t: translate } = pageData(req);
    const files = await getFiles();
    const provider = getCaptchaProviderConfig();
    res.cookie('locale', locale, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.nodeEnv === 'production',
      maxAge: 30 * 86400 * 1000
    });
    res.render('index', {
      locale,
      t: translate,
      provider,
      files: files.map((item) => attachDisplaySize(item, locale))
    });
  } catch (error) {
    next(error);
  }
});

router.get('/download/:slug', async (req, res, next) => {
  try {
    const { locale, t: translate } = pageData(req);
    const fileItem = await getFileBySlug(req.params.slug);
    if (!fileItem) {
      throw publicError('Không tìm thấy file tải.', 'Download file not found.', locale, 404);
    }
    const provider = getCaptchaProviderConfig();
    res.render('download', {
      locale,
      t: translate,
      provider,
      file: attachDisplaySize(fileItem, locale),
      cspNonce: res.locals.cspNonce
    });
  } catch (error) {
    next(error);
  }
});

// ── API: verify captcha (Turnstile), issue download token ─────────────────────

router.post('/api/verify/:slug', simpleRateLimit, enforceFormContentType, async (req, res, next) => {
  try {
    const locale = pickLocale(req, config.allowedLocales);
    const fileItem = await getFileBySlug(req.params.slug);
    if (!fileItem) {
      throw publicError('Không tìm thấy file tải.', 'Download file not found.', locale, 404);
    }

    const captcha = await verifyTurnstileToken(req);
    if (!captcha.success) {
      throw publicError('Xác minh captcha thất bại. Vui lòng thử lại.', 'Captcha verification failed. Please try again.', locale, 403);
    }

    const token = await issueDownloadToken(fileItem, req);
    const baseUrl = buildBaseUrl(req, getServerName(req));
    const downloadUrl = new URL(
      `/files/${fileItem.slug}?token=${encodeURIComponent(token)}`,
      baseUrl
    ).toString();

    res.json({
      ok: true,
      provider: captcha.provider,
      downloadUrl,
      expiresInSeconds: config.downloadTokenTtlSeconds
    });
  } catch (error) {
    next(error);
  }
});

// ── Download endpoint ─────────────────────────────────────────────────────────

router.get('/files/:slug', async (req, res, next) => {
  try {
    const locale = pickLocale(req, config.allowedLocales);
    const fileItem = await getFileBySlug(req.params.slug);
    if (!fileItem) {
      throw publicError('Không tìm thấy file tải.', 'Download file not found.', locale, 404);
    }

    const token = req.query.token;
    const validation = verifyDownloadToken(token, req);
    if (!validation.valid || validation.payload.slug !== fileItem.slug) {
      throw publicError(
        'Liên kết tải không hợp lệ hoặc đã hết hạn.',
        'Download link is invalid or expired.',
        locale,
        403
      );
    }

    // R2 path: absolutePath not needed
    if (isR2Enabled() && (fileItem.storage?.r2Key || fileItem.storage?.relativePath)) {
      return await streamDownload(fileItem, req, res, null);
    }

    const absolutePath = await resolveStoragePath(fileItem);
    await streamDownload(fileItem, req, res, absolutePath);
  } catch (error) {
    next(error);
  }
});

export default router;
