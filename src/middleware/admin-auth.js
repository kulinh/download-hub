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

const CSRF_HEADER = 'x-admin-csrf';
const CSRF_PARAM = '_csrf';

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

  // Expose CSRF token for UI form (slice of signed token)
  res.locals.adminCsrfToken = token.slice(-16);
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
  // Derive CSRF token from session cookie tail (last 16 chars)
  const csrfToken = token ? token.slice(-16) : '';
  res.locals.adminCsrfToken = csrfToken;

  // CSRF validation for state-mutating requests (POST/PATCH/DELETE).
  // GET requests are exempt. Legacy bearer-token requests are exempt.
  // sameSite:strict cookie already mitigates most CSRF, but we also
  // enforce the X-CSRF-Token header or _csrf body field for defence-in-depth.
  const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];
  if (!SAFE_METHODS.includes(req.method)) {
    const headerToken = req.headers['x-csrf-token'] || '';
    const bodyToken = req.body?.['_csrf'] || '';
    if (headerToken !== csrfToken && bodyToken !== csrfToken) {
      return res.status(403).json({ ok: false, error: 'csrf_token_invalid' });
    }
  }

  next();
}

// Accept either admin session cookie or legacy bearer token
export function requireAdminSessionOrToken(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  if (config.adminBearerToken && authHeader.startsWith('Bearer ')) {
    const bearer = authHeader.slice(7);
    if (bearer === config.adminBearerToken) {
      req.adminSession = { role: 'admin', legacy: true };
      return next();
    }
  }
  return requireAdminSession(req, res, next);
}

/**
 * requireAdminSessionPage — UI routes: redirects to /admin/login instead of 401.
 */
export function requireAdminSessionPage(req, res, next) {
  // Allow legacy bearer token for page access too (less common, but consistent)
  if (config.adminBearerToken) {
    const authHeader = req.headers['authorization'] || '';
    if (authHeader.startsWith('Bearer ')) {
      const bearer = authHeader.slice(7);
      if (bearer === config.adminBearerToken) {
        req.adminSession = { role: 'admin', legacy: true };
        res.locals.adminCsrfToken = '';
        return next();
      }
    }
  }

  const token = req.cookies?.[config.admin?.cookieName || 'adm_s'];
  const sessionSecret = config.admin?.sessionSecret || '';
  const payload = token && sessionSecret ? verifyHmacToken(token, sessionSecret) : null;

  if (!payload || payload.role !== 'admin' || (payload.exp && Date.now() > payload.exp)) {
    if (payload?.exp && Date.now() > payload.exp) clearAdminSession(res);
    return res.redirect(302, '/admin/login');
  }

  req.adminSession = payload;
  // Generate a simple CSRF value based on session token (for EJS templates)
  res.locals.adminCsrfToken = token ? token.slice(-16) : '';
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
