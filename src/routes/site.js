import express from 'express';
import { getCaptchaProviderConfig, verifyTurnstileToken } from '../lib/captcha.js';
import {
  getFileBySlug,
  getFiles,
  resolveStoragePath
} from '../lib/file-store.js';
import { config } from '../lib/config.js';
import { issueDownloadToken, streamDownload, verifyDownloadToken } from '../lib/download-token.js';
import { t } from '../lib/i18n.js';
import { getStorageObjectKey, getStorageProvider } from '../lib/storage-metadata.js';
import { buildBaseUrl, formatBytes, getServerName, pickLocale, publicError } from '../lib/utils.js';
import { simpleRateLimit } from '../middleware/rate-limit.js';
import { enforceFormContentType } from '../middleware/security.js';
import { isR2Enabled } from '../lib/r2-storage.js';
import { isDropboxConfigured } from '../lib/dropbox-client.js';

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

router.get('/health', (_req, res) => {
  res.json({ ok: true, uptime: Math.floor(process.uptime()) });
});

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

    const provider = getStorageProvider(fileItem);

    if (provider === 'dropbox' && !isDropboxConfigured()) {
      throw publicError(
        'Dịch vụ Dropbox chưa sẵn sàng.',
        'Dropbox storage not available.',
        locale,
        503
      );
    }

    if (provider === 'r2' && (!isR2Enabled() || !getStorageObjectKey(fileItem))) {
      throw publicError(
        'Storage R2 chưa sẵn sàng.',
        'R2 storage not available.',
        locale,
        503
      );
    }

    const absolutePath = provider === 'local' ? await resolveStoragePath(fileItem) : null;
    await streamDownload(fileItem, req, res, absolutePath);
  } catch (error) {
    next(error);
  }
});

export default router;
