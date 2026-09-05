// Public, unauthenticated endpoint for the patient-facing Opportunistic
// Case Finding (OCF) form (ocf-form.html).
//
// Unlike gh-proxy.js — which requires a signed staff session for every
// read/write — this function has to accept requests from patients who
// are never logged into the Hub. To keep that safe it is single-purpose:
// it takes no `file` parameter, only ever appends to the one hardcoded
// ocf-submissions.json, and validates every field server-side before
// writing anything.
//
// Staff then read/manage ocf-submissions.json as normal through the
// authenticated gh-proxy.js (see ALLOWED_FILES there) via the OCF Inbox.

const REPO = 'prunch-kinsealy/kinsealy-intranet';
const BRANCH = 'main';
const FILE = 'ocf-submissions.json';
const MAX_LEN = 300;

function ghHeaders(token) {
  return { 'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json' };
}

function clean(v) {
  return typeof v === 'string' ? v.trim().slice(0, MAX_LEN) : '';
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const token = process.env.KMC_GITHUB_TOKEN;
  if (!token) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server not configured' }) };
  }

  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  // Honeypot — real patients never fill this in.
  if (clean(payload.botField)) {
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  }

  const name = clean(payload.name);
  const dob = clean(payload.dob);
  const phone = clean(payload.phone);
  const email = clean(payload.email);
  const cardType = clean(payload.cardType);
  const cardNumber = clean(payload.cardNumber);
  const eligibilityConfirmed = payload.eligibilityConfirmed === true;
  const consentGiven = payload.consentGiven === true;

  if (!name || !dob || !phone || !['GMS', 'DVC'].includes(cardType) || !cardNumber
      || !eligibilityConfirmed || !consentGiven) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing or invalid required fields' }) };
  }

  const record = {
    id: Date.now(),
    submitted: new Date().toISOString(),
    status: 'new',
    name, dob, phone, email,
    cardType, cardNumber,
    fields: {
      'Full Name': name,
      'Date of Birth': dob,
      'Phone Number': phone,
      'Email Address': email,
      'GMS or DVC': cardType,
      'GMS / DVC Number': cardNumber,
      'Confirmed not currently on CDM or Prevention Programme': eligibilityConfirmed ? 'Yes' : 'No',
      'Consents to OCF bloods being submitted under the scheme': consentGiven ? 'Yes' : 'No'
    }
  };

  try {
    let sha = null;
    let list = [];
    const infoResp = await fetch('https://api.github.com/repos/' + REPO + '/contents/' + FILE, { headers: ghHeaders(token) });
    if (infoResp.ok) {
      const info = await infoResp.json();
      sha = info.sha;
      list = JSON.parse(Buffer.from(info.content, 'base64').toString('utf-8'));
    }
    list.push(record);

    const body = {
      message: 'OCF form submission - ' + name,
      content: Buffer.from(JSON.stringify(list, null, 2), 'utf-8').toString('base64'),
      branch: BRANCH
    };
    if (sha) body.sha = sha;

    const putResp = await fetch('https://api.github.com/repos/' + REPO + '/contents/' + FILE, {
      method: 'PUT',
      headers: Object.assign({ 'Content-Type': 'application/json' }, ghHeaders(token)),
      body: JSON.stringify(body)
    });
    if (!putResp.ok) {
      return { statusCode: 502, body: JSON.stringify({ error: 'Could not save submission' }) };
    }
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Unexpected error' }) };
  }
};
