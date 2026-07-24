// Shared session-token and password-hashing helpers for the auth and
// gh-proxy functions. Nothing here is ever sent to the browser — the
// browser only ever sees an opaque signed token, never a secret or a
// password hash.

const crypto = require('crypto');

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64');
}

function signToken(claims, secret) {
  const payload = b64url(Buffer.from(JSON.stringify(claims)));
  const sig = b64url(crypto.createHmac('sha256', secret).update(payload).digest());
  return payload + '.' + sig;
}

function verifyToken(token, secret) {
  if (!token || typeof token !== 'string' || token.indexOf('.') === -1) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expectedSig = b64url(crypto.createHmac('sha256', secret).update(payload).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let claims;
  try { claims = JSON.parse(fromB64url(payload).toString('utf-8')); } catch (e) { return null; }
  if (!claims.exp || Date.now() > claims.exp) return null;
  return claims;
}

// Extracts and verifies the bearer token from a Netlify function event.
// Returns the decoded claims, or null if missing/invalid/expired.
function requireAuth(event, secret) {
  const headers = event.headers || {};
  const authHeader = headers.authorization || headers.Authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  return verifyToken(authHeader.slice(7), secret);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return salt + ':' + hash;
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string' || stored.indexOf(':') === -1) return false;
  const [salt, hashHex] = stored.split(':');
  let expected;
  try { expected = Buffer.from(hashHex, 'hex'); } catch (e) { return false; }
  const actual = crypto.scryptSync(password, salt, 64);
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

module.exports = { signToken, verifyToken, requireAuth, hashPassword, verifyPassword, SESSION_TTL_MS };
