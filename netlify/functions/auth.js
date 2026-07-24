// Server-side login and password management.
//
// passwords.json is read and written here, directly via the GitHub API,
// using the server-side KMC_GITHUB_TOKEN. It is never sent to the browser —
// not the plaintext, not the hash, not the file. The browser only ever
// receives a short-lived signed session token after a successful login.

const { signToken, verifyToken, requireAuth, hashPassword, verifyPassword, SESSION_TTL_MS } = require('./_auth');

const REPO = 'prunch-kinsealy/kinsealy-intranet';
const BRANCH = 'main';
const PWD_FILE = 'passwords.json';

// Keep in sync with USERS in login.html. Only `role` matters here — it gets
// baked into the signed session token so the server (not the client) is the
// source of truth for who's an admin.
const ROLES = {
  fran: 'admin', joanne: 'admin', maria: 'admin',
  ciara: 'staff', ruth: 'staff', eimear: 'staff', laura: 'staff',
  susan: 'staff', michaela: 'staff', holly: 'staff', edel: 'staff', amy: 'staff'
};

function ghHeaders(token) {
  return { 'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json' };
}

async function readPasswords(ghToken) {
  const r = await fetch('https://api.github.com/repos/' + REPO + '/contents/' + PWD_FILE, { headers: ghHeaders(ghToken) });
  if (!r.ok) throw new Error('GitHub read failed');
  const j = await r.json();
  return { sha: j.sha, data: JSON.parse(Buffer.from(j.content, 'base64').toString('utf-8')) };
}

async function writePasswords(ghToken, data, sha, message) {
  const body = {
    message,
    content: Buffer.from(JSON.stringify(data, null, 2), 'utf-8').toString('base64'),
    branch: BRANCH
  };
  if (sha) body.sha = sha;
  const r = await fetch('https://api.github.com/repos/' + REPO + '/contents/' + PWD_FILE, {
    method: 'PUT',
    headers: Object.assign({ 'Content-Type': 'application/json' }, ghHeaders(ghToken)),
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error('GitHub write failed');
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const ghToken = process.env.KMC_GITHUB_TOKEN;
  const sessionSecret = process.env.KMC_SESSION_SECRET;
  if (!ghToken || !sessionSecret) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server not configured' }) };
  }

  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  // ── Login ──────────────────────────────────────────────────────────
  if (payload.action === 'login') {
    const username = String(payload.username || '').trim().toLowerCase();
    const password = String(payload.password || '');
    const role = ROLES[username];
    const genericError = { statusCode: 401, body: JSON.stringify({ error: 'Incorrect username or password' }) };
    if (!username || !password || !role) return genericError;

    let pwds;
    try { pwds = (await readPasswords(ghToken)).data; } catch (e) {
      return { statusCode: 502, body: JSON.stringify({ error: 'Could not verify credentials right now — please try again' }) };
    }
    const stored = pwds[username];
    if (!stored || !verifyPassword(password, stored)) return genericError;

    const token = signToken({ u: username, r: role, exp: Date.now() + SESSION_TTL_MS }, sessionSecret);
    return { statusCode: 200, body: JSON.stringify({ ok: true, token, role }) };
  }

  // ── Verify an existing session (used for defense-in-depth page gating) ──
  if (payload.action === 'verify') {
    const claims = verifyToken(payload.token, sessionSecret);
    return { statusCode: 200, body: JSON.stringify({ valid: !!claims, role: claims ? claims.r : null }) };
  }

  // ── Change your own password ──────────────────────────────────────
  if (payload.action === 'change-password') {
    const claims = requireAuth(event, sessionSecret);
    if (!claims) return { statusCode: 401, body: JSON.stringify({ error: 'Not authenticated' }) };
    const newPassword = String(payload.newPassword || '');
    if (newPassword.length < 8) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Password must be at least 8 characters' }) };
    }
    let sha, data;
    try { ({ sha, data } = await readPasswords(ghToken)); } catch (e) {
      return { statusCode: 502, body: JSON.stringify({ error: 'Could not read password store' }) };
    }
    data[claims.u] = hashPassword(newPassword);
    try { await writePasswords(ghToken, data, sha, 'Password change — ' + claims.u); } catch (e) {
      return { statusCode: 502, body: JSON.stringify({ error: 'Could not save new password' }) };
    }
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  }

  // ── Admin: reset another user's password ──────────────────────────
  if (payload.action === 'reset-password') {
    const claims = requireAuth(event, sessionSecret);
    if (!claims || claims.r !== 'admin') {
      return { statusCode: 403, body: JSON.stringify({ error: 'Admin access required' }) };
    }
    const target = String(payload.username || '').trim().toLowerCase();
    const newPassword = String(payload.newPassword || '');
    if (!ROLES[target]) return { statusCode: 400, body: JSON.stringify({ error: 'Unknown user' }) };
    if (newPassword.length < 8) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Password must be at least 8 characters' }) };
    }
    let sha, data;
    try { ({ sha, data } = await readPasswords(ghToken)); } catch (e) {
      return { statusCode: 502, body: JSON.stringify({ error: 'Could not read password store' }) };
    }
    data[target] = hashPassword(newPassword);
    try { await writePasswords(ghToken, data, sha, 'Password reset for ' + target + ' by ' + claims.u); } catch (e) {
      return { statusCode: 502, body: JSON.stringify({ error: 'Could not save new password' }) };
    }
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  }

  return { statusCode: 400, body: JSON.stringify({ error: 'Unknown action' }) };
};
