// Annual leave / sick leave request-and-approve workflow. Mirrors edits.js:
// authorization is enforced server-side from the signed session token on
// every action — the client never gets to claim who it is, whose request
// it's reviewing, or what someone else's leave entitlement is.
//
// leave-requests.json and leave-entitlements.json are deliberately NOT in
// gh-proxy's ALLOWED_FILES — if they were, any authenticated (non-admin)
// staff member could POST straight to gh-proxy and forge approvals or
// rewrite someone else's entitlement. Every mutation here goes through the
// checks below instead.
//
// On submit (sick) or approval (annual), the request is also mirrored into
// away-status.json so the existing Who's-In-Today widget, buddy alerts,
// away notices and welcome-back flow all pick it up with no changes of
// their own — this file is the system of record for the leave history and
// entitlement balance; away-status.json stays the "who's away right now"
// board it already was.

const { requireAuth } = require('./_auth');

const REPO = 'prunch-kinsealy/kinsealy-intranet';
const BRANCH = 'main';
const REQUESTS_FILE = 'leave-requests.json';
const ENTITLEMENTS_FILE = 'leave-entitlements.json';
const AWAY_FILE = 'away-status.json';

const MAX_RANGE_DAYS = 366;

function ghHeaders(token) {
  return { 'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json' };
}

async function readFile(token, file) {
  const r = await fetch('https://api.github.com/repos/' + REPO + '/contents/' + file, { headers: ghHeaders(token) });
  if (!r.ok) throw new Error('GitHub read failed for ' + file);
  const j = await r.json();
  return { sha: j.sha, content: Buffer.from(j.content, 'base64').toString('utf-8') };
}

async function writeFile(token, file, content, sha, message) {
  const body = {
    message,
    content: Buffer.from(content, 'utf-8').toString('base64'),
    branch: BRANCH
  };
  if (sha) body.sha = sha;
  const r = await fetch('https://api.github.com/repos/' + REPO + '/contents/' + file, {
    method: 'PUT',
    headers: Object.assign({ 'Content-Type': 'application/json' }, ghHeaders(token)),
    body: JSON.stringify(body)
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.message || 'GitHub write failed for ' + file);
  }
}

async function readJson(token, file, fallback) {
  try {
    const { sha, content } = await readFile(token, file);
    return { sha, data: JSON.parse(content) };
  } catch (e) {
    return { sha: null, data: fallback };
  }
}

// Counts Mon–Fri days inclusive of both ends. Deliberately does not
// subtract Irish public holidays — flagged as an approximation in the UI
// rather than silently hardcoding a holiday calendar that would drift.
function countWorkingDays(startStr, endStr) {
  const start = new Date(startStr + 'T12:00:00');
  const end = new Date(endStr + 'T12:00:00');
  let count = 0;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}

function isValidDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + 'T12:00:00').getTime());
}

// Mirror an entry into away-status.json so the existing "who's in" board,
// buddy alerts and welcome-back flow reflect it without any changes there.
async function syncAwayStatus(token, username, entry) {
  const { sha, data } = await readJson(token, AWAY_FILE, {});
  data[username] = {
    status: entry.type === 'sick' ? 'sick' : 'holiday',
    destination: entry.destination || '',
    departureDate: entry.startDate,
    returnDate: entry.endDate || '',
    buddy: entry.buddy || '',
    messages: (data[username] && data[username].messages) || [],
    welcomedBack: false
  };
  await writeFile(token, AWAY_FILE, JSON.stringify(data, null, 2), sha, 'Sync away status from leave request (' + username + ')');
}

exports.handler = async (event) => {
  const ghToken = process.env.KMC_GITHUB_TOKEN;
  const sessionSecret = process.env.KMC_SESSION_SECRET;
  if (!ghToken || !sessionSecret) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server not configured' }) };
  }

  const claims = requireAuth(event, sessionSecret);
  if (!claims) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Not authenticated' }) };
  }

  if (event.httpMethod === 'GET') {
    const { data: requests } = await readJson(ghToken, REQUESTS_FILE, []);
    const { data: entitlements } = await readJson(ghToken, ENTITLEMENTS_FILE, {});
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requests, entitlements }) };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  // ── Submit a leave request ──────────────────────────────────────────
  if (payload.action === 'submit') {
    const type = payload.type === 'sick' ? 'sick' : payload.type === 'annual' ? 'annual' : null;
    const startDate = String(payload.startDate || '');
    const endDate = String(payload.endDate || '');
    const note = String(payload.note || '').slice(0, 1000);
    const destination = String(payload.destination || '').slice(0, 200);
    const buddy = String(payload.buddy || '').slice(0, 50);

    if (!type) return { statusCode: 400, body: JSON.stringify({ error: 'Leave type must be annual or sick' }) };
    if (!isValidDate(startDate)) return { statusCode: 400, body: JSON.stringify({ error: 'Invalid start date' }) };
    // Sick leave may still be open-ended (you don't always know your return day in advance).
    if (endDate && !isValidDate(endDate)) return { statusCode: 400, body: JSON.stringify({ error: 'Invalid end date' }) };
    if (type === 'annual' && !endDate) return { statusCode: 400, body: JSON.stringify({ error: 'Annual leave needs a return date' }) };
    if (endDate && endDate < startDate) return { statusCode: 400, body: JSON.stringify({ error: 'Return date is before the start date' }) };
    if (endDate && (new Date(endDate + 'T12:00:00') - new Date(startDate + 'T12:00:00')) / 86400000 > MAX_RANGE_DAYS) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Date range is implausibly long' }) };
    }

    let sha, requests;
    try { ({ sha, data: requests } = await readJson(ghToken, REQUESTS_FILE, [])); } catch (e) {
      return { statusCode: 502, body: JSON.stringify({ error: 'Could not read leave requests' }) };
    }

    const entry = {
      id: Date.now(),
      username: claims.u,
      type,
      startDate,
      endDate: endDate || null,
      days: endDate ? countWorkingDays(startDate, endDate) : null,
      destination,
      buddy,
      note,
      submittedAt: new Date().toISOString(),
      // Sick leave is self-logged, same as it always was via the away-status
      // modal — no PM gate. Annual leave needs sign-off since it draws down
      // a shared entitlement.
      status: type === 'sick' ? 'approved' : 'pending',
      reviewedBy: null,
      reviewedAt: type === 'sick' ? new Date().toISOString() : null,
      reviewNote: null
    };
    requests.unshift(entry);

    try {
      await writeFile(ghToken, REQUESTS_FILE, JSON.stringify(requests, null, 2), sha, (type === 'sick' ? 'Log sick leave' : 'Request annual leave') + ' — ' + claims.u);
    } catch (e) {
      return { statusCode: 502, body: JSON.stringify({ error: 'Could not save the request' }) };
    }

    if (entry.status === 'approved') {
      try { await syncAwayStatus(ghToken, claims.u, entry); } catch (e) { /* request is saved either way; the away board can be fixed manually */ }
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true, id: entry.id }) };
  }

  // ── Withdraw your own still-pending request ─────────────────────────
  if (payload.action === 'cancel') {
    const id = Number(payload.id);
    let sha, requests;
    try { ({ sha, data: requests } = await readJson(ghToken, REQUESTS_FILE, [])); } catch (e) {
      return { statusCode: 502, body: JSON.stringify({ error: 'Could not read leave requests' }) };
    }
    const entry = requests.find(r => r.id === id);
    if (!entry) return { statusCode: 404, body: JSON.stringify({ error: 'Request not found' }) };
    if (entry.username !== claims.u) return { statusCode: 403, body: JSON.stringify({ error: 'Not your request' }) };
    if (entry.status !== 'pending') return { statusCode: 409, body: JSON.stringify({ error: 'Only a still-pending request can be withdrawn' }) };

    entry.status = 'withdrawn';
    entry.reviewedAt = new Date().toISOString();
    try {
      await writeFile(ghToken, REQUESTS_FILE, JSON.stringify(requests, null, 2), sha, 'Withdraw leave request ' + id + ' — ' + claims.u);
    } catch (e) {
      return { statusCode: 502, body: JSON.stringify({ error: 'Could not withdraw the request' }) };
    }
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  }

  // ── Review (approve/reject) an annual leave request — admin only ────
  if (payload.action === 'review') {
    if (claims.r !== 'admin') {
      return { statusCode: 403, body: JSON.stringify({ error: 'Admin access required' }) };
    }
    const id = Number(payload.id);
    const decision = payload.decision === 'approve' ? 'approved' : payload.decision === 'reject' ? 'rejected' : null;
    if (!id || !decision) return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request' }) };
    const reviewNote = String(payload.reviewNote || '').slice(0, 1000);

    let sha, requests;
    try { ({ sha, data: requests } = await readJson(ghToken, REQUESTS_FILE, [])); } catch (e) {
      return { statusCode: 502, body: JSON.stringify({ error: 'Could not read leave requests' }) };
    }
    const entry = requests.find(r => r.id === id);
    if (!entry) return { statusCode: 404, body: JSON.stringify({ error: 'Request not found' }) };
    if (entry.status !== 'pending') return { statusCode: 409, body: JSON.stringify({ error: 'This request was already reviewed' }) };

    if (decision === 'approved') {
      try { await syncAwayStatus(ghToken, entry.username, entry); } catch (e) {
        return { statusCode: 502, body: JSON.stringify({ error: 'Could not update the away-status board: ' + e.message }) };
      }
    }

    entry.status = decision;
    entry.reviewedBy = claims.u;
    entry.reviewedAt = new Date().toISOString();
    entry.reviewNote = reviewNote;
    try {
      await writeFile(ghToken, REQUESTS_FILE, JSON.stringify(requests, null, 2), sha, (decision === 'approved' ? 'Approve' : 'Reject') + ' leave request ' + id + ' by ' + claims.u);
    } catch (e) {
      return { statusCode: 502, body: JSON.stringify({ error: (decision === 'approved' ? 'Away status updated, but' : 'Could not') + ' update the request record — please check manually' }) };
    }
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  }

  // ── Set a staff member's annual leave entitlement — admin only ──────
  if (payload.action === 'setEntitlement') {
    if (claims.r !== 'admin') {
      return { statusCode: 403, body: JSON.stringify({ error: 'Admin access required' }) };
    }
    const username = String(payload.username || '');
    const days = Number(payload.days);
    if (!username) return { statusCode: 400, body: JSON.stringify({ error: 'Missing username' }) };
    if (!Number.isFinite(days) || days < 0 || days > 365) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Entitlement must be a number of days between 0 and 365' }) };
    }

    let sha, entitlements;
    try { ({ sha, data: entitlements } = await readJson(ghToken, ENTITLEMENTS_FILE, {})); } catch (e) {
      return { statusCode: 502, body: JSON.stringify({ error: 'Could not read entitlements' }) };
    }
    entitlements[username] = days;
    try {
      await writeFile(ghToken, ENTITLEMENTS_FILE, JSON.stringify(entitlements, null, 2), sha, 'Set ' + username + ' annual leave entitlement to ' + days + ' — by ' + claims.u);
    } catch (e) {
      return { statusCode: 502, body: JSON.stringify({ error: 'Could not save the entitlement' }) };
    }
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  }

  return { statusCode: 400, body: JSON.stringify({ error: 'Unknown action' }) };
};
