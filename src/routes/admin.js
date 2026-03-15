/**
 * admin.js — Admin routes: login/logout + R2 management APIs
 *
 * Routes:
 *   GET  /admin/login         → login page (with hCaptcha by default)
 *   POST /admin/login         → authenticate
 *   POST /admin/logout        → destroy session
 *   GET  /admin               → redirect to /admin/r2
 *   GET  /admin/r2            → R2 management UI (session-protected)
 *
 *   GET  /api/admin/r2/status      → R2 config health
 *   GET  /api/admin/r2/files       → list R2 objects merged with files.json catalog
 *   POST /api/admin/r2/sync        → sync R2 objects into files.json
 *   DELETE /api/admin/r2/files/:slug → delete file (R2 + catalog)
 *   PATCH /api/admin/r2/files/:slug/publish  → toggle publish
 *   PATCH /api/admin/r2/files/:slug/metadata → update title/summary/version/platform
 *   POST /api/admin/r2/upload-url  → get presigned PUT URL
 *   POST /api/admin/r2/upload-confirm → confirm upload, add to catalog
 *
 *   (Legacy compatibility)
 *   GET  /api/admin/files     → disk-based list (bearer token still works)
 *   POST /api/admin/sync      → disk sync
 *   POST /api/admin/reload    → reload cache
 */

import express from 'express';
import path from 'node:path';
import { config } from '../lib/config.js';
import { getHcaptchaConfig, verifyHcaptchaToken } from '../lib/captcha.js';
import { enforceFormContentType, enforceJsonContentType } from '../middleware/security.js';
import {
  getAllFiles,
  getFiles,
  reloadFiles,
  scanStorageFiles,
  syncFilesIndexFromDisk,
  readRawFilesIndex,
  writeRawFilesIndex
} from '../lib/file-store.js';
import { isR2Configured, listR2Objects, deleteR2Object, getPresignedDownloadUrl } from '../lib/r2-client.js';
import { getPresignedUploadUrl as getSdkPresignedUploadUrl } from '../lib/r2-storage.js';
import {
  clearAdminSession,
  issueAdminSession,
  requireAdminSession,
  requireAdminSessionOrToken,
  requireAdminSessionPage,
  validateAdminCredentials
} from '../middleware/admin-auth.js';
import { pickLocale } from '../lib/utils.js';
import { t } from '../lib/i18n.js';
import { simpleRateLimit } from '../middleware/rate-limit.js';
import { requireAdminToken } from '../middleware/security.js';

const router = express.Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

function pageData(req) {
  const locale = pickLocale(req, config.allowedLocales);
  return { locale, t: (key) => t(locale, key) };
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'file';
}

function inferPlatform(key) {
  const k = key.toLowerCase();
  if (k.includes('android/') || k.endsWith('.apk')) return 'Android';
  if (k.includes('ios/')) return 'iOS';
  if (k.includes('mac') || k.endsWith('.dmg') || k.endsWith('.pkg')) return 'macOS';
  if (k.includes('windows/') || k.endsWith('.exe') || k.endsWith('.msi')) return 'Windows';
  return 'Generic';
}

function titleFromKey(key) {
  const base = path.basename(key);
  const noExt = base.replace(/\.[^.]+$/, '');
  return noExt.split(/[-_]+/).filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}

// ── Admin login page ─────────────────────────────────────────────────────────

router.get('/admin/login', (req, res) => {
  const { locale } = pageData(req);
  // Admin login uses hCaptcha exclusively (not Turnstile — that's for public flow)
  const hcaptcha = getHcaptchaConfig();
  res.render('admin-login', {
    locale,
    hcaptcha,
    error: req.query.error || null,
    csrfToken: '',
    cspNonce: res.locals.cspNonce
  });
});

router.post('/admin/login', simpleRateLimit, enforceFormContentType, async (req, res) => {
  const { locale } = pageData(req);
  const { username = '', password = '' } = req.body || {};
  const adminUser = config.admin?.username || '';
  const adminPass = config.admin?.password || '';

  if (!adminUser && !adminPass) {
    return res.redirect('/admin/login?error=admin_disabled');
  }

  if (!password) {
    return res.redirect('/admin/login?error=invalid_credentials');
  }

  // Verify hCaptcha if configured (admin panel uses hCaptcha, not Turnstile)
  const hcaptcha = getHcaptchaConfig();
  if (hcaptcha) {
    try {
      const captcha = await verifyHcaptchaToken(req);
      if (!captcha.success) {
        return res.redirect('/admin/login?error=captcha_failed');
      }
    } catch (err) {
      return res.redirect('/admin/login?error=captcha_failed');
    }
  }

  // Validate credentials
  if (!validateAdminCredentials(username || adminUser, password)) {
    return res.redirect('/admin/login?error=invalid_credentials');
  }

  clearAdminSession(res);
  issueAdminSession(res);
  res.redirect('/admin/r2?lang=' + locale);
});

router.post('/admin/logout', (req, res) => {
  clearAdminSession(res);
  const { locale } = pageData(req);
  res.redirect('/admin/login?lang=' + locale);
});

// ── Admin redirect ────────────────────────────────────────────────────────────

router.get('/admin', (req, res) => {
  const { locale } = pageData(req);
  res.redirect('/admin/r2?lang=' + locale);
});

// ── R2 Admin UI ───────────────────────────────────────────────────────────────

router.get('/admin/r2', requireAdminSessionPage, (req, res, next) => {
  try {
    const { locale, t: translate } = pageData(req);
    res.render('admin-r2', {
      locale,
      t: translate,
      csrfToken: res.locals.adminCsrfToken || '',
      cspNonce: res.locals.cspNonce
    });
  } catch (err) {
    next(err);
  }
});

// ── R2 Status API ─────────────────────────────────────────────────────────────

router.get('/api/admin/r2/status', requireAdminSession, (req, res) => {
  const configured = isR2Configured();
  res.json({
    ok: true,
    r2Configured: configured,
    bucket: configured ? config.r2?.bucket : null
  });
});

// ── R2 File List API ──────────────────────────────────────────────────────────

router.get('/api/admin/r2/files', requireAdminSession, async (req, res, next) => {
  try {
    const [catalogRaw, r2Objects] = await Promise.all([
      getAllFiles(),
      isR2Configured() ? listR2Objects() : Promise.resolve([])
    ]);

    // Build a merged view
    const catalogByR2Key = new Map();
    for (const entry of catalogRaw) {
      const key = entry?.r2?.key || entry?.storage?.relativePath || entry.slug;
      if (key) catalogByR2Key.set(key, entry);
    }

    const files = [];

    // R2 objects are source of truth for what exists
    for (const obj of r2Objects) {
      const catalog = catalogByR2Key.get(obj.key) || null;
      files.push({
        r2Key: obj.key,
        sizeBytes: obj.sizeBytes,
        lastModified: obj.lastModified,
        slug: catalog?.slug || slugify(path.basename(obj.key)),
        title: catalog?.title || { vi: titleFromKey(obj.key), en: titleFromKey(obj.key) },
        summary: catalog?.summary || { vi: '', en: '' },
        version: catalog?.version || '1.0.0',
        platform: catalog?.platform || inferPlatform(obj.key),
        published: Boolean(catalog?.published),
        featured: Boolean(catalog?.featured),
        updatedAt: catalog?.updatedAt || obj.lastModified,
        r2: { key: obj.key },
        inCatalog: Boolean(catalog)
      });
    }

    // Also include catalog entries that no longer exist in R2 (orphans)
    for (const entry of catalogRaw) {
      if (!entry?.r2?.key) continue;
      if (!r2Objects.some((o) => o.key === entry.r2.key)) {
        files.push({
          r2Key: entry.r2.key,
          sizeBytes: entry.sizeBytes || 0,
          lastModified: entry.updatedAt || null,
          slug: entry.slug,
          title: entry.title,
          summary: entry.summary,
          version: entry.version,
          platform: entry.platform,
          published: Boolean(entry.published),
          featured: Boolean(entry.featured),
          updatedAt: entry.updatedAt,
          r2: entry.r2,
          inCatalog: true,
          r2Missing: true
        });
      }
    }

    res.json({ ok: true, files, total: files.length });
  } catch (err) {
    next(err);
  }
});

// ── R2 Sync Index ─────────────────────────────────────────────────────────────

router.post('/api/admin/r2/sync', requireAdminSession, enforceJsonContentType, async (req, res, next) => {
  try {
    if (!isR2Configured()) {
      return res.json({ ok: true, synced: 0, message: 'r2_not_configured' });
    }

    const [r2Objects, existing] = await Promise.all([
      listR2Objects(),
      getAllFiles()
    ]);

    const byR2Key = new Map(existing.map((e) => [e?.r2?.key, e]).filter(([k]) => k));
    const updated = [...existing];
    let created = 0;
    let updatedCount = 0;

    for (const obj of r2Objects) {
      const entry = byR2Key.get(obj.key);
      if (entry) {
        entry.sizeBytes = obj.sizeBytes;
        entry.updatedAt = obj.lastModified;
        updatedCount++;
      } else {
        const slug = slugify(path.basename(obj.key));
        updated.push({
          id: slug + '-' + Date.now(),
          slug,
          title: { vi: titleFromKey(obj.key), en: titleFromKey(obj.key) },
          summary: { vi: '', en: '' },
          description: { vi: '', en: '' },
          version: '1.0.0',
          platform: inferPlatform(obj.key),
          language: ['vi', 'en'],
          sizeBytes: obj.sizeBytes,
          checksumSha256: '',
          mimeType: 'application/octet-stream',
          r2: { key: obj.key, downloadName: path.basename(obj.key) },
          published: false,
          featured: false,
          demo: false,
          tags: [],
          updatedAt: obj.lastModified
        });
        created++;
      }
    }

    await writeRawFilesIndex(updated);
    res.json({ ok: true, synced: r2Objects.length, created, updated: updatedCount });
  } catch (err) {
    next(err);
  }
});

// ── Delete file ───────────────────────────────────────────────────────────────

router.delete('/api/admin/r2/files/:slug', requireAdminSession, async (req, res, next) => {
  try {
    const { slug } = req.params;
    const catalog = await getAllFiles();
    const idx = catalog.findIndex((e) => e.slug === slug || (e.r2?.key && e.r2.key === slug));
    if (idx < 0) return res.status(404).json({ ok: false, error: 'not_found' });

    const entry = catalog[idx];
    const r2Key = entry?.r2?.key;

    // Delete from R2 if configured and key present
    if (isR2Configured() && r2Key) {
      await deleteR2Object(r2Key);
    }

    // Remove from catalog
    catalog.splice(idx, 1);
    await writeRawFilesIndex(catalog);

    res.json({ ok: true, deleted: slug });
  } catch (err) {
    next(err);
  }
});

// ── Toggle publish ────────────────────────────────────────────────────────────

router.patch('/api/admin/r2/files/:slug/publish', requireAdminSession, enforceJsonContentType, async (req, res, next) => {
  try {
    const { slug } = req.params;
    const { published } = req.body || {};
    const catalog = await getAllFiles();
    const entry = catalog.find((e) => e.slug === slug);
    if (!entry) return res.status(404).json({ ok: false, error: 'not_found' });

    entry.published = Boolean(published);
    await writeRawFilesIndex(catalog);
    await reloadFiles();
    res.json({ ok: true, slug, published: entry.published });
  } catch (err) {
    next(err);
  }
});

// ── Update metadata ───────────────────────────────────────────────────────────

router.patch('/api/admin/r2/files/:slug/metadata', requireAdminSession, enforceJsonContentType, async (req, res, next) => {
  try {
    const { slug } = req.params;
    const { title, summary, version, platform } = req.body || {};
    const catalog = await getAllFiles();
    const entry = catalog.find((e) => e.slug === slug);
    if (!entry) return res.status(404).json({ ok: false, error: 'not_found' });

    if (title && typeof title === 'object') entry.title = { ...entry.title, ...title };
    if (summary && typeof summary === 'object') entry.summary = { ...entry.summary, ...summary };
    if (version) entry.version = String(version).slice(0, 50);
    if (platform) entry.platform = String(platform).slice(0, 50);
    entry.updatedAt = new Date().toISOString();

    await writeRawFilesIndex(catalog);
    await reloadFiles();
    res.json({ ok: true, slug });
  } catch (err) {
    next(err);
  }
});

// ── Presigned upload URL ──────────────────────────────────────────────────────

router.post('/api/admin/r2/upload-url', requireAdminSession, enforceJsonContentType, async (req, res, next) => {
  try {
    if (!isR2Configured()) {
      return res.status(503).json({ ok: false, error: 'r2_not_configured' });
    }
    const { filename, contentType } = req.body || {};
    if (!filename) return res.status(400).json({ ok: false, error: 'filename_required' });

    const r2Key = String(filename).replace(/\.\./g, '').replace(/^\/+/, '');
    const uploadUrl = await getSdkPresignedUploadUrl(r2Key, contentType || 'application/octet-stream', 900);
    res.json({ ok: true, uploadUrl, r2Key });
  } catch (err) {
    next(err);
  }
});

// ── Confirm upload ────────────────────────────────────────────────────────────

router.post('/api/admin/r2/upload-confirm', requireAdminSession, enforceJsonContentType, async (req, res, next) => {
  try {
    const { r2Key, filename, sizeBytes, contentType } = req.body || {};
    if (!r2Key) return res.status(400).json({ ok: false, error: 'r2key_required' });

    const catalog = await getAllFiles();
    const existing = catalog.find((e) => e?.r2?.key === r2Key);
    if (!existing) {
      const slug = slugify(path.basename(r2Key));
      catalog.push({
        id: slug + '-' + Date.now(),
        slug,
        title: { vi: titleFromKey(r2Key), en: titleFromKey(r2Key) },
        summary: { vi: '', en: '' },
        description: { vi: '', en: '' },
        version: '1.0.0',
        platform: inferPlatform(r2Key),
        language: ['vi', 'en'],
        sizeBytes: sizeBytes || 0,
        checksumSha256: '',
        mimeType: contentType || 'application/octet-stream',
        r2: { key: r2Key, downloadName: filename || path.basename(r2Key) },
        published: false,
        featured: false,
        demo: false,
        tags: [],
        updatedAt: new Date().toISOString()
      });
    } else {
      existing.sizeBytes = sizeBytes || existing.sizeBytes;
      existing.updatedAt = new Date().toISOString();
    }

    await writeRawFilesIndex(catalog);
    res.json({ ok: true, r2Key });
  } catch (err) {
    next(err);
  }
});

// ── Legacy endpoints (bearer token, disk-based) ───────────────────────────────

router.get('/api/admin/files', requireAdminSessionOrToken, async (req, res, next) => {
  try {
    const [entries, scanned] = await Promise.all([
      getAllFiles(),
      scanStorageFiles()
    ]);
    const scannedByPath = new Map(scanned.map((item) => [item.relativePath, item]));
    const files = entries.map((entry) => {
      const disk = scannedByPath.get(entry?.storage?.relativePath);
      return { ...entry, disk: disk ? { exists: true, ...disk } : { exists: false } };
    });
    const extraDiskFiles = scanned.filter((item) => !entries.some((e) => e?.storage?.relativePath === item.relativePath));
    res.json({ ok: true, files, extraDiskFiles, storagePath: config.filesStoragePath, filesIndexPath: config.filesIndexPath, adminEnabled: true });
  } catch (err) {
    next(err);
  }
});

router.post('/api/admin/sync', requireAdminSessionOrToken, enforceJsonContentType, async (req, res, next) => {
  try {
    const result = await syncFilesIndexFromDisk();
    res.json({ ok: true, created: result.created, updated: result.updated, unchanged: result.unchanged, totalEntries: result.entries.length });
  } catch (err) {
    next(err);
  }
});

router.post('/api/admin/reload', requireAdminSessionOrToken, enforceJsonContentType, async (req, res, next) => {
  try {
    const files = await reloadFiles();
    res.json({ ok: true, count: files.length });
  } catch (err) {
    next(err);
  }
});

export default router;
