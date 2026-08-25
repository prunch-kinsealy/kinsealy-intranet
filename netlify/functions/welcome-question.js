// Server-side generator for the "welcome back" AI question.
//
// The Anthropic API key lives only in the Netlify env (KMC_ANTHROPIC_API_KEY)
// and is never sent to the browser — the client just gets back the finished
// question text (or null, if no key is configured or the call fails, in
// which case the caller falls back to a canned question).

const { requireAuth } = require('./_auth');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const sessionSecret = process.env.KMC_SESSION_SECRET;
  const apiKey = process.env.KMC_ANTHROPIC_API_KEY;
  if (!sessionSecret) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server not configured' }) };
  }
  if (!requireAuth(event, sessionSecret)) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Not authenticated' }) };
  }

  if (!apiKey) {
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: null }) };
  }

  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }
  const destination = String(payload.destination || '').trim().slice(0, 200);
  if (!destination) {
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: null }) };
  }

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 120,
        messages: [{
          role: 'user',
          content: `A colleague just returned from a holiday in ${destination}. Write one warm, specific, curious question to welcome them back — something that shows genuine interest in their trip (food, culture, a famous landmark, weather, hidden gem, etc.). Keep it to one sentence. No preamble, just the question.`
        }]
      })
    });
    if (!resp.ok) {
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: null }) };
    }
    const json = await resp.json();
    const question = json.content && json.content[0] && json.content[0].text ? json.content[0].text.trim() : '';
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: question || null }) };
  } catch (e) {
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: null }) };
  }
};
