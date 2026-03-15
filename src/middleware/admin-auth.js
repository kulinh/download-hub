/**
 * admin-auth.js — Hard authentication for admin panel
 *
 * Flow:
 *   1. POST /admin/login — username + password + hCaptcha
 *   2. On success: issue signed admin session cookie
 *   3. Subsequent admin API requests: verify cookie via requireAdminSession
 *
 * Design:
 *   - Cookie-based session (HMAC-signed, same approach as download tokens)
 *   - hCaptcha mandatory on login
 *   - No plain Bearer token for UI routes (replaced by session cookie)
 *   - Legacy ADMIN_BEARER_TOKEN still honoured by requireAdminToken in security.js
 */

import { timingSafeEqual } from 'node:crypto';
import { config } from '../lib/config.js';
import { createHmacToken, verifyHmacToken } from '../lib/utils.js';

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'strict',
  path: '/admin'
};

// ── Session issuance / clearing ──────────────────────────────────────────────

export function issueAdminSession(res) {
  const expiresAt = Date.now() + (config.admin.sessionTtlSeconds * 1000);
  const payload = { role: 'admin', exp: expiresAt };
  const token = createHmacToken(payload, config.admin.sessionSecret);

  res.cookie(config.admin.cookieName, token, {
    ...COOKIE_OPTIONS,
    secure: config.nodeEnv === 'production',
    maxAge: config.admin.sessionTtlSeconds * 1000
  });

  return token;
}

export function clearAdminSession(res) {
  res.clearCookie(config.admin.cookieName, {
    ...COOKIE_OPTIONS,
    secure: config.nodeEnv === 'production'
  });
}

// ── Middleware ────────────────────────────────────────────────────────────────

/**
 * requireAdminSession — API routes: returns 401 JSON if not authenticated.
 * Accepts either:
 *   1. Admin session cookie (new flow)
 *   2. Legacy Bearer token header (backward compat, if ADMIN_BEARER_TOKEN is set)
 */
export function requireAdminSession(req, res, next) {
  // Backward compat: legacy bearer token (for tests + existing automation)
  if (config.adminBearerToken) {
    const authHeader = req.headers['authorization'] || '';
    if (authHeader.startsWith('Bearer ')) {
      const bearer = authHeader.slice(7);
      if (bearer === config.adminBearerToken) {
        req.adminSession = { role: 'admin', legacy: true };
        return next();
      }
    }
  }

  const token = req.cookies?.[config.admin?.cookieName || 'adm_s'];
  if (!token) {
    return res.status(401).json({ ok: false, error: 'admin_session_required' });
  }

  const sessionSecret = config.admin?.sessionSecret || config.adminSessionSecret || '';
  if (!sessionSecret) {
    return res.status(401).json({ ok: false, error: 'admin_session_required' });
  }

  const payload = verifyHmacToken(token, sessionSecret);
  if (!payload || payload.role !== 'admin') {
    return res.status(401).json({ ok: false, error: 'invalid_admin_session' });
  }

  if (!payload.exp || Date.now() > payload.exp) {
    clearAdminSession(res);
    return res.status(401).json({ ok: false, error: 'admin_session_expired' });
  }

  req.adminSession = payload;
  next();
}

/**
 * requireAdminSessionPage — UI routes: redirects to /admin/login instead of 401.
 */
export function requireAdminSessionPage(req, res, next) {
  const token = req.cookies?.[config.admin.cookieName];
  const payload = token ? verifyHmacToken(token, config.admin.sessionSecret) : null;

  if (!payload || payload.role !== 'admin' || (payload.exp && Date.now() > payload.exp)) {
    if (payload?.exp && Date.now() > payload.exp) clearAdminSession(res);
    return res.redirect(302, '/admin/login');
  }

  req.adminSession = payload;
  next();
}

// ── Credential validation ─────────────────────────────────────────────────────

export function validateAdminCredentials(username, password) {
  if (!config.admin.username || !config.admin.password) return false;
  try {
    const a = Buffer.from(String(username) + ':' + String(password));
    const b = Buffer.from(config.admin.username + ':' + config.admin.password);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
