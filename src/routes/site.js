import express from 'express';
import { getCaptchaProviderConfig, verifyCaptchaToken } from '../lib/captcha.js';
import { getFileBySlug, getFiles, reloadFiles, resolveStoragePath } from '../lib/file-store.js';
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

// ── Health check ─────────────────────────────────────────────────────────────

router.get('/health', (_req, res) => {
  res.json({ ok: true, uptime: Math.floor(process.uptime()) });
});

// ── Admin: reload files index without restart ─────────────────────────────────

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
      files: files.map((item) => ({
        ...item,
        displaySize: formatBytes(item.sizeBytes, locale)
      }))
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
      file: { ...fileItem, displaySize: formatBytes(fileItem.sizeBytes, locale) }
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
