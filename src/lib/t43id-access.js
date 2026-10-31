/**
 * t43id-access.js — verify the Cloudflare Access JWT (t43id sign-in) in front of /admin.
 * Port of @kulinh/t43id accessVerifier (t43stack/id/ts). Headers alone prove nothing:
 * the JWT is checked against the team's keys, AUD and group.
 */
import { createRemoteJWKSet, jwtVerify } from 'jose';

export const ACCESS_HEADER = 'cf-access-jwt-assertion';
export const ACCESS_COOKIE = 'CF_Authorization';

const remoteKeys = new Map();
let testKeys = null;

/** Tests only: replace the remote key set. */
export function setAccessKeysForTest(keys) {
  testKeys = keys;
}

export function tokenFrom(header, cookieHeader) {
  if (header && String(header).trim()) return String(header).trim();
  for (const part of String(cookieHeader || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === ACCESS_COOKIE && v.length) return v.join('=');
  }
  return null;
}

/** Returns {email, groups} or null when the token is missing, invalid, or not in allowGroups. */
export async function verifyAccess(req, { teamDomain, audience, allowGroups = [] }) {
  const token = tokenFrom(req.headers[ACCESS_HEADER], req.headers.cookie);
  if (!token || !audience) return null;
  const issuer = `https://${String(teamDomain).replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;
  let keys = testKeys || remoteKeys.get(issuer);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    remoteKeys.set(issuer, keys);
  }
  let payload;
  try {
    ({ payload } = await jwtVerify(token, keys, {
      issuer,
      audience,
      algorithms: ['RS256'],
      requiredClaims: ['exp'],
      clockTolerance: 60
    }));
  } catch {
    return null;
  }
  const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : '';
  const custom = payload.custom || {};
  const groups = Array.isArray(custom.groups) ? custom.groups.filter((g) => typeof g === 'string')
    : typeof custom.groups === 'string' ? [custom.groups] : [];
  if (!email) return null;
  if (allowGroups.length && !allowGroups.some((g) => groups.includes(g))) return null;
  return { email, groups };
}
