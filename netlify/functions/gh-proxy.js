// Server-side proxy for reading/writing the Hub's JSON data files.
// The GitHub token lives only in the Netlify env (KMC_GITHUB_TOKEN) and is
// never sent to the browser. Only files in ALLOWED_FILES can be touched, and
// only by a caller with a valid, signed session token (see _auth.js and
// auth.js) — anonymous requests are rejected before anything is read.
//
// passwords.json is deliberately NOT in ALLOWED_FILES — it is handled only
// by auth.js, which never returns its contents to the browser.

const { requireAuth } = require('./_auth');

const REPO = 'prunch-kinsealy/kinsealy-intranet';
const BRANCH = 'main';
const ALLOWED_FILES = new Set([
  'metrics-data.json',
  'away-status.json',
  'feedback.json',
  'cdm-submissions.json',
  'prevention-submissions.json',
  'ocf-submissions.json',
  'cdm-bulk-text.json',
  'projects.json',
  'notices.json'
]);

function ghHeaders(token) {
  return { 'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json' };
}

exports.handler = async (event) => {
  const token = process.env.KMC_GITHUB_TOKEN;
  const sessionSecret = process.env.KMC_SESSION_SECRET;
  if (!token || !sessionSecret) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server not configured' }) };
  }

  if (!requireAuth(event, sessionSecret)) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Not authenticated' }) };
  }

  if (event.httpMethod === 'GET') {
    const file = event.queryStringParameters && event.queryStringParameters.file;
    if (!ALLOWED_FILES.has(file)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Unknown file' }) };
    }
    const r = await fetch('https://api.github.com/repos/' + REPO + '/contents/' + file, { headers: ghHeaders(token) });
    if (!r.ok) {
      return { statusCode: r.status, body: JSON.stringify({ error: 'GitHub read failed' }) };
    }
    const j = await r.json();
    const decoded = Buffer.from(j.content, 'base64').toString('utf-8');
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sha: j.sha, json: JSON.parse(decoded) })
    };
  }

  if (event.httpMethod === 'POST') {
    let payload;
    try { payload = JSON.parse(event.body || '{}'); } catch (e) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
    }
    const { file, content, message } = payload;
    if (!ALLOWED_FILES.has(file)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Unknown file' }) };
    }
    if (content === undefined) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing content' }) };
    }

    // Always fetch the latest sha server-side right before writing.
    let sha = null;
    const infoResp = await fetch('https://api.github.com/repos/' + REPO + '/contents/' + file, { headers: ghHeaders(token) });
    if (infoResp.ok) { const info = await infoResp.json(); sha = info.sha; }

    const body = {
      message: message || ('Update ' + file + ' ' + new Date().toISOString().slice(0, 10)),
      content: Buffer.from(JSON.stringify(content, null, 2), 'utf-8').toString('base64'),
      branch: BRANCH
    };
    if (sha) body.sha = sha;

    const putResp = await fetch('https://api.github.com/repos/' + REPO + '/contents/' + file, {
      method: 'PUT',
      headers: Object.assign({ 'Content-Type': 'application/json' }, ghHeaders(token)),
      body: JSON.stringify(body)
    });
    if (!putResp.ok) {
      const err = await putResp.json().catch(() => ({}));
      return { statusCode: putResp.status, body: JSON.stringify({ error: err.message || 'GitHub write failed' }) };
    }
    const j = await putResp.json();
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, sha: j.content ? j.content.sha : null })
    };
  }

  return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
};
