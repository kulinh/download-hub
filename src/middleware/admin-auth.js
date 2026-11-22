import { config } from '../lib/config.js';
import { verifyAccess } from '../lib/t43id-access.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function bearerOk(req) {
  if (!config.adminBearerToken) return false;
  const authHeader = req.headers['authorization'] || '';
  return authHeader.startsWith('Bearer ') && authHeader.slice(7) === config.adminBearerToken;
}

async function identify(req) {
  if (!config.t43id?.accessAud) return null;
  return verifyAccess(req, {
    teamDomain: config.t43id.teamDomain,
    audience: config.t43id.accessAud,
    allowGroups: config.t43id.allowGroups
  });
}

function crossSite(req) {
  const site = req.headers['sec-fetch-site'];
  return Boolean(site) && site !== 'same-origin' && site !== 'none';
}

export async function requireAdminSession(req, res, next) {
  try {
    if (bearerOk(req)) {
      req.adminSession = { role: 'admin', legacy: true };
      return next();
    }
    const id = await identify(req);
    if (!id) return res.status(401).json({ ok: false, error: 'admin_session_required' });
    if (!SAFE_METHODS.has(req.method) && crossSite(req)) {
      return res.status(403).json({ ok: false, error: 'cross_site_request_blocked' });
    }
    req.adminSession = { role: 'admin', email: id.email };
    next();
  } catch (err) {
    next(err);
  }
}

export const requireAdminSessionOrToken = requireAdminSession;

export async function requireAdminSessionPage(req, res, next) {
  try {
    if (bearerOk(req)) {
      req.adminSession = { role: 'admin', legacy: true };
      return next();
    }
    const id = await identify(req);
    if (!id) {
      return res.status(403).type('text').send('Sign in with T43iD: open /admin through download.888vn.net.');
    }
    req.adminSession = { role: 'admin', email: id.email };
    next();
  } catch (err) {
    next(err);
  }
}
