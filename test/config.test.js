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

  it('fails fast in production when no captcha provider configured', () => {
    const runner = () => buildConfig({
      NODE_ENV: 'production',
      DOWNLOAD_TOKEN_SECRET: 'strong-secret'
    });
    expect(runner).toThrow(/Captcha provider/);
  });

  it('allows explicit trust proxy list', () => {
    const cfg = buildConfig({ TRUST_PROXY: 'loopback,uniquelocal' });
    expect(cfg.trustProxy).toEqual(['loopback', 'uniquelocal']);
  });
});
