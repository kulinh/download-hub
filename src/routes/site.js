import express from 'express';
import { getCaptchaProviderConfig, verifyCaptchaToken } from '../lib/captcha.js';
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

// ── Admin UI + APIs ──────────────────────────────────────────────────────────

router.get('/admin', async (req, res, next) => {
  try {
    const { locale, t: translate } = pageData(req);
    res.render('admin', {
      locale,
      t: translate,
      adminEnabled: Boolean(config.adminBearerToken)
    });
  } catch (error) {
    next(error);
  }
});

router.get('/api/admin/files', requireAdminToken, async (req, res, next) => {
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

    res.json({
      ok: true,
      files,
      extraDiskFiles,
      storagePath: config.filesStoragePath,
      filesIndexPath: config.filesIndexPath,
      adminEnabled: Boolean(config.adminBearerToken)
    });
  } catch (error) {
    next(error);
  }
});

router.post('/api/admin/sync', requireAdminToken, async (req, res, next) => {
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

router.post('/api/admin/reload', requireAdminToken, async (req, res, next) => {
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
    // provider may be null — template handles graceful "captcha unavailable" state
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

// ── API: verify captcha, issue download token ─────────────────────────────────

router.post('/api/verify/:slug', simpleRateLimit, enforceFormContentType, async (req, res, next) => {
  try {
    const locale = pickLocale(req, config.allowedLocales);
    const fileItem = await getFileBySlug(req.params.slug);
    if (!fileItem) {
      throw publicError('Không tìm thấy file tải.', 'Download file not found.', locale, 404);
    }

    const captcha = await verifyCaptchaToken(req);
    if (!captcha.provider) {
      throw publicError('Chưa cấu hình captcha hợp lệ.', 'No valid captcha provider is configured.', locale, 500);
    }
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

    const absolutePath = await resolveStoragePath(fileItem);
    await streamDownload(fileItem, req, res, absolutePath);
  } catch (error) {
    next(error);
  }
});

export default router;
