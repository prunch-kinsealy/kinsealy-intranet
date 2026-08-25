// Approval-gated content-edit workflow for staff granted `editSections` in
// login.html (see EDITABLE_SECTIONS there and CLAUDE.md's "Content
// contribution model"). A grantee submits proposed content for a section
// they're authorised for; nothing on the live site changes until an admin
// reviews it here and approves. Authorization is enforced server-side from
// the signed session token on every action — the client never gets to claim
// who it is or what it's allowed to touch.
//
// pending-edits.json is deliberately NOT in gh-proxy's ALLOWED_FILES — if it
// were, any authenticated (non-admin) staff member could POST straight to
// gh-proxy and rewrite the whole queue, forging approvals or other people's
// submissions. Every mutation here goes through the checks below instead.

const { requireAuth } = require('./_auth');

const REPO = 'prunch-kinsealy/kinsealy-intranet';
const BRANCH = 'main';
const FILE = 'pending-edits.json';

// Keep in sync with USERS[x].editSections in login.html.
const EDIT_GRANTS = {
  ruth: ['roaccutane']
};

// Keep in sync with EDITABLE_SECTIONS[x].targets in login.html.
const EDIT_TARGETS = {
  roaccutane: [
    { file: 'roaccutane-consent.html', mode: 'whole' },
    { file: 'index.html', mode: 'anchor', marker: 'ROACCUTANE' }
  ]
};

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

async function readPendingEdits(token) {
  try {
    const { sha, content } = await readFile(token, FILE);
    return { sha, edits: JSON.parse(content) };
  } catch (e) {
    return { sha: null, edits: [] };
  }
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
    const { edits } = await readPendingEdits(ghToken);
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ edits }) };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  // ── Submit a proposed edit ──────────────────────────────────────────
  if (payload.action === 'submit') {
    const section = String(payload.section || '');
    const file = String(payload.file || '');
    const note = String(payload.note || '').slice(0, 2000);
    const proposedContent = String(payload.proposedContent || '');

    const grants = EDIT_GRANTS[claims.u] || [];
    if (!grants.includes(section)) {
      return { statusCode: 403, body: JSON.stringify({ error: 'You are not authorised to edit this section' }) };
    }
    const targets = EDIT_TARGETS[section] || [];
    const target = targets.find(t => t.file === file);
    if (!target) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Unknown target file for this section' }) };
    }
    if (!proposedContent.trim()) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Proposed content is empty' }) };
    }

    let sha, edits;
    try { ({ sha, edits } = await readPendingEdits(ghToken)); } catch (e) {
      return { statusCode: 502, body: JSON.stringify({ error: 'Could not read pending edits' }) };
    }
    const entry = {
      id: Date.now(),
      section,
      file,
      mode: target.mode,
      marker: target.marker || null,
      submittedBy: claims.u,
      submittedAt: new Date().toISOString(),
      note,
      proposedContent,
      status: 'pending',
      reviewedBy: null,
      reviewedAt: null,
      reviewNote: null
    };
    edits.unshift(entry);
    try {
      await writeFile(ghToken, FILE, JSON.stringify(edits, null, 2), sha, 'Propose edit: ' + section + ' by ' + claims.u);
    } catch (e) {
      return { statusCode: 502, body: JSON.stringify({ error: 'Could not save proposal' }) };
    }
    return { statusCode: 200, body: JSON.stringify({ ok: true, id: entry.id }) };
  }

  // ── Review (approve/reject) a proposed edit — admin only ────────────
  if (payload.action === 'review') {
    if (claims.r !== 'admin') {
      return { statusCode: 403, body: JSON.stringify({ error: 'Admin access required' }) };
    }
    const id = Number(payload.id);
    const decision = payload.decision === 'approve' ? 'approved' : payload.decision === 'reject' ? 'rejected' : null;
    if (!id || !decision) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request' }) };
    }
    const reviewNote = String(payload.reviewNote || '').slice(0, 2000);

    let sha, edits;
    try { ({ sha, edits } = await readPendingEdits(ghToken)); } catch (e) {
      return { statusCode: 502, body: JSON.stringify({ error: 'Could not read pending edits' }) };
    }
    const entry = edits.find(e => e.id === id);
    if (!entry) return { statusCode: 404, body: JSON.stringify({ error: 'Edit not found' }) };
    if (entry.status !== 'pending') {
      return { statusCode: 409, body: JSON.stringify({ error: 'This edit was already reviewed' }) };
    }

    // Publish first, only mark it reviewed once that succeeds — a failed
    // publish leaves the item pending (so it can be retried) rather than
    // silently marking it approved with nothing actually live.
    if (decision === 'approved') {
      try {
        if (entry.mode === 'whole') {
          let targetSha = null;
          try { targetSha = (await readFile(ghToken, entry.file)).sha; } catch (e) { /* new file */ }
          await writeFile(ghToken, entry.file, entry.proposedContent, targetSha, 'Publish approved edit: ' + entry.section + ' (approved by ' + claims.u + ')');
        } else if (entry.mode === 'anchor') {
          const { sha: targetSha, content: targetContent } = await readFile(ghToken, entry.file);
          const startTag = '<!-- SYNC:' + entry.marker + '-BODY:START -->';
          const endTag = '<!-- SYNC:' + entry.marker + '-BODY:END -->';
          const startIdx = targetContent.indexOf(startTag);
          const endIdx = targetContent.indexOf(endTag);
          if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
            throw new Error('Sync markers not found in ' + entry.file);
          }
          const newContent = targetContent.slice(0, startIdx + startTag.length)
            + '\n' + entry.proposedContent + '\n'
            + targetContent.slice(endIdx);
          await writeFile(ghToken, entry.file, newContent, targetSha, 'Publish approved edit: ' + entry.section + ' (approved by ' + claims.u + ')');
        } else {
          throw new Error('Unknown target mode');
        }
      } catch (e) {
        return { statusCode: 502, body: JSON.stringify({ error: 'Could not publish the change: ' + e.message }) };
      }
    }

    entry.status = decision;
    entry.reviewedBy = claims.u;
    entry.reviewedAt = new Date().toISOString();
    entry.reviewNote = reviewNote;
    try {
      await writeFile(ghToken, FILE, JSON.stringify(edits, null, 2), sha, (decision === 'approved' ? 'Approve' : 'Reject') + ' edit ' + id + ' by ' + claims.u);
    } catch (e) {
      return { statusCode: 502, body: JSON.stringify({ error: (decision === 'approved' ? 'Published, but' : 'Could not') + ' update the queue record — please check manually' }) };
    }
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  }

  return { statusCode: 400, body: JSON.stringify({ error: 'Unknown action' }) };
};
