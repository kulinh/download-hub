import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reloadConfig } from '../src/lib/config.js';
import * as dropboxClient from '../src/lib/dropbox-client.js';

const ENABLED_ENV = {
  NODE_ENV: 'development',
  DOWNLOAD_TOKEN_SECRET: 'secret',
  TURNSTILE_ENABLED: 'false',
  HCAPTCHA_ENABLED: 'false',
  FILES_INDEX_PATH: '/tmp/files.json',
  FILES_STORAGE_PATH: '/tmp/storage',
  DROPBOX_ENABLED: 'true',
  DROPBOX_APP_KEY: 'test-key',
  DROPBOX_APP_SECRET: 'test-secret',
  DROPBOX_REFRESH_TOKEN: 'test-refresh'
};

afterEach(() => {
  vi.restoreAllMocks();
  dropboxClient._resetTokenCache();
});

describe('isDropboxConfigured', () => {
  it('returns true when all dropbox env vars set and enabled', () => {
    reloadConfig(ENABLED_ENV);
    expect(dropboxClient.isDropboxConfigured()).toBe(true);
  });

  it('returns false when DROPBOX_ENABLED=false', () => {
    reloadConfig({ ...ENABLED_ENV, DROPBOX_ENABLED: 'false' });
    expect(dropboxClient.isDropboxConfigured()).toBe(false);
  });

  it('returns false when any credential is missing', () => {
    reloadConfig({ ...ENABLED_ENV, DROPBOX_APP_KEY: '' });
    expect(dropboxClient.isDropboxConfigured()).toBe(false);
  });
});

describe('getAccessToken', () => {
  beforeEach(() => { reloadConfig(ENABLED_ENV); });

  it('fetches and caches access token via refresh token flow', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'tok-abc', expires_in: 14400 })
    });
    vi.stubGlobal('fetch', mockFetch);

    const token = await dropboxClient.getAccessToken();
    expect(token).toBe('tok-abc');
    expect(mockFetch).toHaveBeenCalledOnce();

    // Second call uses cache — no second fetch
    const token2 = await dropboxClient.getAccessToken();
    expect(token2).toBe('tok-abc');
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('throws dropbox_token_refresh_failed when Dropbox returns error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      text: async () => 'invalid_grant'
    }));
    await expect(dropboxClient.getAccessToken()).rejects.toThrow('dropbox_token_refresh_failed');
  });
});

describe('getDropboxMetadata', () => {
  beforeEach(() => { reloadConfig(ENABLED_ENV); });

  it('returns file name and size from Dropbox metadata API', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'tok', expires_in: 14400 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ name: 'file.zip', size: 1024, '.tag': 'file' }) })
    );
    const meta = await dropboxClient.getDropboxMetadata('/apps/dl888/file.zip');
    expect(meta.name).toBe('file.zip');
    expect(meta.size).toBe(1024);
  });

  it('throws dropbox_metadata_failed on API error', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'tok', expires_in: 14400 }) })
      .mockResolvedValueOnce({ ok: false, text: async () => 'not_found' })
    );
    await expect(dropboxClient.getDropboxMetadata('/bad/path')).rejects.toThrow('dropbox_metadata_failed');
  });
});
