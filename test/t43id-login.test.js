import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import adminRouter from '../src/routes/admin.js';
import { reloadConfig } from '../src/lib/config.js';
import { setAccessKeysForTest } from '../src/lib/t43id-access.js';

const AUD = 'test-aud-0123456789';
const ISS = 'https://t43.cloudflareaccess.com';
let privateKey;

async function jwt({ aud = AUD, groups = ['admins'], email = 'linh@example.com', key = privateKey } = {}) {
  return new SignJWT({ email, custom: { groups } })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(ISS).setAudience(aud).setSubject('u1').setIssuedAt().setExpirationTime('5m')
    .sign(key);
}

function makeApp() {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());
  app.use(adminRouter);
  return app;
}

describe('admin sign-in with T43iD (Cloudflare Access)', () => {
  beforeAll(async () => {
    const kp = await generateKeyPair('RS256');
    privateKey = kp.privateKey;
    const jwk = { ...(await exportJWK(kp.publicKey)), kid: 'k1', alg: 'RS256' };
    setAccessKeysForTest(createLocalJWKSet({ keys: [jwk] }));
  });

  beforeEach(() => {
    reloadConfig({
      NODE_ENV: 'development',
      DOWNLOAD_TOKEN_SECRET: 'dev-secret-change-me',
      HCAPTCHA_ENABLED: 'false',
      ADMIN_USERNAME: 'a',
      ADMIN_PASSWORD: 'b',
      ADMIN_SESSION_SECRET: 'test-admin-session-secret-32chars!!',
      ADMIN_COOKIE_NAME: 'download_hub_admin_sess',
      T43ID_ACCESS_AUD: AUD
    });
  });

  it('valid Access JWT from the admins group issues the admin session', async () => {
    const res = await request(makeApp()).get('/admin/login').set('Cf-Access-Jwt-Assertion', await jwt());
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^\/admin\/r2/);
    expect(String(res.headers['set-cookie'])).toMatch(/download_hub_admin_sess=/);
  });

  it('accepts the CF_Authorization cookie too', async () => {
    const res = await request(makeApp()).get('/admin/login').set('Cookie', `CF_Authorization=${await jwt()}`);
    expect(res.status).toBe(302);
  });

  it('rejects a missing token, another audience, another group, or a foreign key', async () => {
    const other = (await generateKeyPair('RS256')).privateKey;
    for (const token of [null, await jwt({ aud: 'other' }), await jwt({ groups: ['viewer'] }), await jwt({ key: other })]) {
      const r = request(makeApp()).get('/admin/login');
      const res = token ? await r.set('Cf-Access-Jwt-Assertion', token) : await r;
      expect(res.status).toBe(403);
      expect(res.headers['set-cookie']).toBeUndefined();
    }
  });

  it('password sign-in is disabled', async () => {
    const res = await request(makeApp()).post('/admin/login').type('form').send({ username: 'a', password: 'b' });
    expect(res.status).toBe(403);
  });

  it('logout also ends the Access session', async () => {
    const res = await request(makeApp()).post('/admin/logout');
    expect(res.headers.location).toBe('/cdn-cgi/access/logout');
  });
});
