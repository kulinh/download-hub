import crypto from 'node:crypto';
import helmet from 'helmet';
import { config } from '../lib/config.js';

/**
 * Single helmet instance configured with per-request CSP nonce.
 * Helmet v8 supports nonce functions in directive arrays; the nonce is
 * attached to res.locals before the helmet middleware runs.
 *
 * Note: upgradeInsecureRequests is set to null (disabled) because
 * CloudPanel/Nginx handles HTTPS redirects at the edge, and having it
 * in the CSP is redundant at the app layer.
 */
const helmetMiddleware = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        (req, res) => `'nonce-${res.locals.cspNonce}'`,
        'https://challenges.cloudflare.com',
        'https://js.hcaptcha.com',
        'https://hcaptcha.com'
      ],
      frameSrc: [
        "'self'",
        'https://challenges.cloudflare.com',
        'https://js.hcaptcha.com',
        'https://hcaptcha.com'
      ],
      // unsafe-inline kept for captcha widget injected styles; nonce covers app scripts
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: [
        "'self'",
        'https://challenges.cloudflare.com',
        'https://api.hcaptcha.com',
        'https://hcaptcha.com'
      ],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      // Disable — handled by Nginx at the edge
      upgradeInsecureRequests: null
    }
  },
  referrerPolicy: { policy: 'no-referrer' }
});

export function applyAppSecurity(app) {
  app.disable('x-powered-by');

  if (config.trustProxy !== false) {
    app.set('trust proxy', config.trustProxy);
  }

  // Attach a fresh nonce BEFORE helmet runs so the nonce function can read it
  app.use((req, res, next) => {
    res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
    next();
  });

  app.use(helmetMiddleware);

  // Additional response headers not covered by helmet defaults
  app.use((req, res, next) => {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    next();
  });
}

export function enforceFormContentType(req, res, next) {
  if (req.method !== 'POST') return next();
  const contentType = req.headers['content-type'] || '';
  if (!String(contentType).includes('application/x-www-form-urlencoded')) {
    return res.status(415).json({ ok: false, error: 'unsupported_media_type' });
  }
  next();
}

/**
 * Guard /api/admin/* with a static bearer token.
 * Set ADMIN_BEARER_TOKEN in .env; leave blank to disable admin endpoints entirely.
 */
export function requireAdminToken(req, res, next) {
  const adminToken = config.adminBearerToken;
  if (!adminToken) {
    return res.status(403).json({ ok: false, error: 'admin_disabled' });
  }
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token || token !== adminToken) {
    return res.status(401).json({ ok: false, error: 'admin_session_required' });
  }
  next();
}
