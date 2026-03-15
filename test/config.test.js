import { describe, it, expect } from 'vitest';
import { buildConfig } from '../src/lib/config.js';

describe('config validation', () => {
  it('fails fast in production when download token secret is placeholder', () => {
    const runner = () => buildConfig({
      NODE_ENV: 'production',
      DOWNLOAD_TOKEN_SECRET: 'dev-secret-change-me',
      TURNSTILE_ENABLED: 'true',
      TURNSTILE_SITE_KEY: 'k',
      TURNSTILE_SECRET_KEY: 's'
    });
    expect(runner).toThrow(/DOWNLOAD_TOKEN_SECRET/);
  });

  it('fails fast in production when Turnstile not configured', () => {
    const runner = () => buildConfig({
      NODE_ENV: 'production',
      DOWNLOAD_TOKEN_SECRET: 'strong-secret'
    });
    // New arch: Turnstile is required for public flow in production
    expect(runner).toThrow(/Turnstile/);
  });

  it('fails fast in production when hCaptcha not configured for admin', () => {
    const runner = () => buildConfig({
      NODE_ENV: 'production',
      DOWNLOAD_TOKEN_SECRET: 'strong-secret',
      TURNSTILE_ENABLED: 'true',
      TURNSTILE_SITE_KEY: 'k',
      TURNSTILE_SECRET_KEY: 's'
    });
    // New arch: hCaptcha required for admin panel login
    expect(runner).toThrow(/hCaptcha/);
  });

  it('allows explicit trust proxy list', () => {
    const cfg = buildConfig({ TRUST_PROXY: 'loopback,uniquelocal' });
    expect(cfg.trustProxy).toEqual(['loopback', 'uniquelocal']);
  });
});
