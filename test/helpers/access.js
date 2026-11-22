import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { setAccessKeysForTest } from '../../src/lib/t43id-access.js';

export const AUD = 'test-aud-0123456789';
export const ISS = 'https://t43.cloudflareaccess.com';

let privateKey;

export async function installAccessKeys() {
  const kp = await generateKeyPair('RS256');
  privateKey = kp.privateKey;
  const jwk = { ...(await exportJWK(kp.publicKey)), kid: 'k1', alg: 'RS256' };
  setAccessKeysForTest(createLocalJWKSet({ keys: [jwk] }));
}

export async function signAccessJwt({ aud = AUD, groups = ['admins'], email = 'linh@example.com', key = privateKey } = {}) {
  return new SignJWT({ email, custom: { groups } })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(ISS).setAudience(aud).setSubject('u1').setIssuedAt().setExpirationTime('5m')
    .sign(key);
}
