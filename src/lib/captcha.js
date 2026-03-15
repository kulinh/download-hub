import crypto from 'node:crypto';
import { config } from './config.js';
import { getClientIp } from './utils.js';

export function getCaptchaProviderConfig() {
  if (config.captchaProvider === 'turnstile') {
    return {
      provider: 'turnstile',
      siteKey: config.turnstile.siteKey,
      scriptSrc: 'https://challenges.cloudflare.com/turnstile/v0/api.js',
      fieldName: 'cf-turnstile-response'
    };
  }
  if (config.captchaProvider === 'hcaptcha') {
    return {
      provider: 'hcaptcha',
      siteKey: config.hcaptcha.siteKey,
      scriptSrc: 'https://js.hcaptcha.com/1/api.js',
      fieldName: 'h-captcha-response'
    };
  }
  return null;
}

export async function verifyCaptchaToken(req) {
  const providerConfig = getCaptchaProviderConfig();
  if (!providerConfig) {
    return { success: false, provider: null, reason: 'provider_not_configured' };
  }

  const token = req.body?.[providerConfig.fieldName];
  if (!token || typeof token !== 'string') {
    return { success: false, provider: providerConfig.provider, reason: 'missing_token' };
  }

  const remoteip = getClientIp(req);
  const timeout = AbortSignal.timeout(10000);

  if (providerConfig.provider === 'turnstile') {
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
