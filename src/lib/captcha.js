import crypto from 'node:crypto';
import { config } from './config.js';
import { getClientIp } from './utils.js';

// ── Public flow: Cloudflare Turnstile ────────────────────────────────────────

export function getTurnstileConfig() {
  if (config.turnstile.enabled && config.turnstile.siteKey) {
    return {
      provider: 'turnstile',
      siteKey: config.turnstile.siteKey,
      scriptSrc: 'https://challenges.cloudflare.com/turnstile/v0/api.js',
      fieldName: 'cf-turnstile-response'
    };
  }
  return null;
}

// ── Admin panel: hCaptcha ────────────────────────────────────────────────────

export function getHcaptchaConfig() {
  if (config.hcaptcha.enabled && config.hcaptcha.siteKey) {
    return {
      provider: 'hcaptcha',
      siteKey: config.hcaptcha.siteKey,
      scriptSrc: 'https://js.hcaptcha.com/1/api.js',
      fieldName: 'h-captcha-response'
    };
  }
  return null;
}

/**
 * Legacy helper for public download pages (returns Turnstile config only).
 * Admin pages should use getHcaptchaConfig() directly.
 */
export function getCaptchaProviderConfig() {
  return getTurnstileConfig();
}

// ── Verification ─────────────────────────────────────────────────────────────

/**
 * Verify a Cloudflare Turnstile token (public download flow).
 */
export async function verifyTurnstileToken(req) {
  const token = req.body?.['cf-turnstile-response'];
  if (!token || typeof token !== 'string') {
    return { success: false, provider: 'turnstile', reason: 'missing_token' };
  }

  const remoteip = getClientIp(req);
  const timeout = AbortSignal.timeout(10000);

  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      secret: config.turnstile.secretKey,
      response: token,
      remoteip,
      idempotency_key: crypto.randomUUID()
    }),
    signal: timeout
  });

  const result = await response.json();
  const success = Boolean(result.success)
    && (!result.hostname || result.hostname === config.appHostname)
    && (!result.action || result.action === config.turnstile.action);

  return {
    success,
    provider: 'turnstile',
    hostname: result.hostname,
    action: result.action,
    errors: result['error-codes'] || []
  };
}

/**
 * Verify an hCaptcha token (admin panel flow).
 */
export async function verifyHcaptchaToken(req) {
  const token = req.body?.['h-captcha-response'];
  if (!token || typeof token !== 'string') {
    return { success: false, provider: 'hcaptcha', reason: 'missing_token' };
  }

  const remoteip = getClientIp(req);
  const timeout = AbortSignal.timeout(10000);

  const formBody = new URLSearchParams({
    secret: config.hcaptcha.secretKey,
    response: token,
    remoteip,
    sitekey: config.hcaptcha.siteKey
  });

  const response = await fetch('https://api.hcaptcha.com/siteverify', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: formBody,
    signal: timeout
  });

  const result = await response.json();
  const success = Boolean(result.success)
    && (!result.hostname || result.hostname === config.hcaptcha.expectedHostname);

  return {
    success,
    provider: 'hcaptcha',
    hostname: result.hostname,
    errors: result['error-codes'] || []
  };
}

/**
 * Legacy unified verifier (routes based on captchaProvider config).
 * Kept for backward compat with public flow verify endpoint.
 */
export async function verifyCaptchaToken(req) {
  const provider = config.captchaProvider;
  if (!provider) {
    return { success: false, provider: null, reason: 'provider_not_configured' };
  }
  if (provider === 'turnstile') {
    return verifyTurnstileToken(req);
  }
  // Fallback to hcaptcha if turnstile not configured (dev/legacy)
  return verifyHcaptchaToken(req);
}
