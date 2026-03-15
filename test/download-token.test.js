import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { issueDownloadToken, verifyDownloadToken } from '../src/lib/download-token.js';
import { reloadConfig } from '../src/lib/config.js';

function forceExpireByTime(token, advanceMs) {
  const now = Date.now();
  vi.setSystemTime(now + advanceMs);
  return token;
}

describe('download token', () => {
  const file = { slug: 'sample', storage: { downloadName: 'x', relativePath: 'x' } };

  beforeEach(() => {
    vi.useFakeTimers();
    reloadConfig({ DOWNLOAD_TOKEN_SECRET: 'strong-secret', NODE_ENV: 'development', DOWNLOAD_TOKEN_TTL_SECONDS: '1' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('signs and verifies with matching ip/ua and expiry', async () => {
    const req = { ip: '1.1.1.1', get: vi.fn().mockReturnValue('UA') };
    const token = await issueDownloadToken(file, req);
    const verify = verifyDownloadToken(token, req);
    expect(verify.valid).toBe(true);
    expect(verify.payload.slug).toBe('sample');
  });

  it('rejects expired token', async () => {
    const req = { ip: '1.1.1.1', get: vi.fn().mockReturnValue('UA') };
    const token = await issueDownloadToken(file, req);
    forceExpireByTime(token, 2000);
    const verify = verifyDownloadToken(token, req);
    expect(verify.valid).toBe(false);
    expect(verify.reason).toBe('expired');
  });

  it('rejects ip mismatch', async () => {
    const req = { ip: '1.1.1.1', get: vi.fn().mockReturnValue('UA') };
    const token = await issueDownloadToken(file, req);
    const verify = verifyDownloadToken(token, { ip: '2.2.2.2', get: vi.fn().mockReturnValue('UA') });
    expect(verify.valid).toBe(false);
    expect(verify.reason).toBe('ip_mismatch');
  });

  it('rejects ua mismatch', async () => {
    const req = { ip: '1.1.1.1', get: vi.fn().mockReturnValue('UA1') };
    const token = await issueDownloadToken(file, req);
    const verify = verifyDownloadToken(token, { ip: '1.1.1.1', get: vi.fn().mockReturnValue('UA2') });
    expect(verify.valid).toBe(false);
    expect(verify.reason).toBe('ua_mismatch');
  });
});
