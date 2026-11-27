/* ============================================================================
   Viesigners tools API — shared settings for the internal HTML tools (/tools/).
   Cloudflare Worker + KV. Runs on https://viesigners.com/tools-api/*

   GET  /tools-api/settings/<tool>   → { settings, updatedAt } (or { settings: null })   public read
   PUT  /tools-api/settings/<tool>   body { settings }                                    needs the edit password
   GET  /tools-api/check             → 204 if the password is right                      needs the edit password

   The edit password is a Worker secret (EDIT_PASSWORD), sent as "Authorization: Bearer <password>".
   It never appears in this repository or in the page.
   ========================================================================== */

const ALLOWED_ORIGINS = ['https://viesigners.com', 'https://www.viesigners.com', 'http://localhost:4173'];
const TOOL_ID = /^[a-z0-9-]{1,64}$/;
const MAX_BYTES = 64 * 1024;

function cors(request) {
  const origin = request.headers.get('Origin');
  const h = { 'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '86400', Vary: 'Origin' };
  if (origin && ALLOWED_ORIGINS.includes(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}
const json = (request, body, status = 200) => new Response(body === null ? null : JSON.stringify(body), {
  status,
  headers: { ...cors(request), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
});

/* constant-time comparison so the password can't be guessed by timing */
async function authorized(request, env) {
  const given = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!env.EDIT_PASSWORD || !given) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(given)), crypto.subtle.digest('SHA-256', enc.encode(env.EDIT_PASSWORD))]);
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let diff = 0; for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/tools-api/, '');
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(request) });

    if (path === '/check' && request.method === 'GET') {
      return (await authorized(request, env)) ? json(request, null, 204) : json(request, { error: 'Mot de passe invalide' }, 401);
    }

    const m = path.match(/^\/settings\/([^/]+)$/);
    if (!m || !TOOL_ID.test(m[1])) return json(request, { error: 'Not found' }, 404);
    const key = `settings:${m[1]}`;

    if (request.method === 'GET') {
      const stored = await env.TOOLS_KV.get(key, 'json');
      return json(request, stored || { settings: null, updatedAt: null });
    }

    if (request.method === 'PUT') {
      if (!(await authorized(request, env))) return json(request, { error: 'Mot de passe invalide' }, 401);
      const raw = await request.text();
      if (raw.length > MAX_BYTES) return json(request, { error: 'Trop volumineux' }, 413);
      let body;
      try { body = JSON.parse(raw); } catch { return json(request, { error: 'JSON invalide' }, 400); }
      if (!body || typeof body.settings !== 'object' || Array.isArray(body.settings) || body.settings === null) return json(request, { error: 'Format invalide' }, 400);
      const record = { settings: body.settings, updatedAt: new Date().toISOString() };
      await env.TOOLS_KV.put(key, JSON.stringify(record));
      return json(request, record);
    }

    return json(request, { error: 'Method not allowed' }, 405);
  },
};
