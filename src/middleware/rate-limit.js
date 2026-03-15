import { config } from '../lib/config.js';

/**
 * In-process sliding-window rate limiter with periodic GC.
 * Uses per-IP:path keys. Suitable for low-traffic deployments (no Redis required).
 *
 * GC: entries older than 2× the window are purged on every request that
 * triggers the cleanup threshold (every 500 requests), preventing unbounded
 * Map growth on sustained traffic.
 */

const bucket = new Map();
let gcCounter = 0;
const GC_INTERVAL = 500; // prune every N requests

function pruneExpired() {
  const now = Date.now();
  for (const [key, entry] of bucket) {
    if (now > entry.resetAt) {
      bucket.delete(key);
    }
  }
}

export function simpleRateLimit(req, res, next) {
  const key = `${req.ip}:${req.path}`;
  const now = Date.now();
  const windowMs = config.rateLimitWindowSeconds * 1000;

  let entry = bucket.get(key);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + windowMs };
  }

  entry.count += 1;
  bucket.set(key, entry);

  // Periodic GC to prevent unbounded Map growth
  gcCounter += 1;
  if (gcCounter >= GC_INTERVAL) {
    gcCounter = 0;
    pruneExpired();
  }

  if (entry.count > config.rateLimitMaxAttempts) {
    const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    res.setHeader('Retry-After', retryAfter);
    return res.status(429).json({ ok: false, error: 'rate_limited' });
  }

  next();
}
