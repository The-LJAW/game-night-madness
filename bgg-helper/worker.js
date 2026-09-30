/**
 * BGG helper for Game Night Madness (a Cloudflare Worker).
 *
 * BoardGameGeek requires every app to send a registered token, and asks apps to keep that token
 * on a server and to cache results. This tiny helper does exactly that:
 *   - holds the token (a secret named BGG_TOKEN, set in the Cloudflare dashboard),
 *   - answers only the app's own website (ALLOWED_ORIGINS),
 *   - allows only two lookups: a user's owned board games, and details for up to 20 games,
 *   - caches good answers (30 minutes for collections, 7 days for game details).
 *
 * Endpoints (GET):
 *   /collection?username=NAME   -> BGG XML for NAME's owned board games (no expansions)
 *   /thing?id=1,2,3             -> BGG XML details (with stats) for up to 20 game ids
 *   /                           -> status page: running, token set or not, cache, allowed sites
 *
 * Settings (Cloudflare dashboard -> the Worker -> Settings -> Variables and Secrets):
 *   BGG_TOKEN        Secret. The token from boardgamegeek.com/applications. Required.
 *   ALLOWED_ORIGINS  Text. Optional. Comma-separated sites allowed to call this helper.
 *                    Default: https://the-ljaw.github.io (only change it for a custom domain)
 * Binding (the Worker -> Bindings): a KV namespace named CACHE, so answers are reused
 * (Cloudflare's built-in cache only works once the Worker is on your own domain).
 */

const BGG = 'https://boardgamegeek.com/xmlapi2/';
const TTL = {collection: 30 * 60, thing: 7 * 24 * 3600};

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const allowed = String(env.ALLOWED_ORIGINS || 'https://the-ljaw.github.io')
      .split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean);
    const origin = req.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0],
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Expose-Headers': 'Retry-After, X-GNM-Cache, X-GNM-Error',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin'
    };
    const reply = (body, status, extra) => new Response(body, {
      status, headers: Object.assign({'Content-Type': 'text/plain; charset=utf-8'}, cors, extra || {})
    });

    if (req.method === 'OPTIONS') return reply(null, 204);
    if (req.method !== 'GET') return reply('Only GET is allowed.', 405);
    if (url.pathname === '/' || url.pathname === '') {
      // Status page: open the helper's address in a browser to check the setup. Never shows the token.
      return reply([
        'Game Night Madness BGG helper: running',
        'BGG token: ' + (env.BGG_TOKEN ? 'set' : 'not set yet (add BGG_TOKEN as a Secret under Settings > Variables and Secrets)'),
        'Cache: ' + (env.CACHE ? 'KV namespace bound as CACHE' : 'no KV bound (bind a KV namespace as CACHE so answers are reused)'),
        'Allowed sites: ' + allowed.join(', ')
      ].join('\n') + '\n', 200);
    }
    // Browsers always send Origin on these cross-site calls; anything else isn't the app.
    if (!allowed.includes(origin)) return reply('This site is not allowed to use the BGG helper.', 403);
    if (!env.BGG_TOKEN) return reply('The BGG token is not set on this helper yet.', 503, {'X-GNM-Error': 'no-token'});

    let kind, target;
    if (url.pathname === '/collection') {
      const user = (url.searchParams.get('username') || '').trim();
      if (!/^[A-Za-z0-9_][A-Za-z0-9_ .\-]{0,39}$/.test(user)) return reply('That does not look like a BGG username.', 400);
      kind = 'collection';
      target = BGG + 'collection?username=' + encodeURIComponent(user) +
        '&own=1&stats=1&subtype=boardgame&excludesubtype=boardgameexpansion';
    } else if (url.pathname === '/thing') {
      const ids = [...new Set((url.searchParams.get('id') || '').split(',').map(s => s.trim()).filter(s => /^\d{1,8}$/.test(s)))]
        .sort((a, b) => a - b);
      if (!ids.length || ids.length > 20) return reply('Ask for 1 to 20 game ids.', 400);
      kind = 'thing';
      target = BGG + 'thing?stats=1&id=' + ids.join(',');
    } else {
      return reply('Not found.', 404);
    }

    const xml = extra => Object.assign({'Content-Type': 'text/xml; charset=utf-8'}, extra);
    const cacheKey = 'v1:' + (kind === 'collection' ? target.toLowerCase() : target);

    // 1) Cache (KV if bound, otherwise Cloudflare's edge cache, which works on custom domains)
    try {
      if (env.CACHE) {
        const hit = await env.CACHE.get(cacheKey);
        if (hit) return reply(hit, 200, xml({'X-GNM-Cache': 'hit'}));
      } else {
        const hit = await caches.default.match(new Request('https://gnm-cache.invalid/' + encodeURIComponent(cacheKey)));
        if (hit) return reply(await hit.text(), 200, xml({'X-GNM-Cache': 'hit'}));
      }
    } catch (e) { /* caching is a bonus; carry on */ }

    // 2) Ask BoardGameGeek
    let up;
    try {
      up = await fetch(target, {headers: {
        'Authorization': 'Bearer ' + env.BGG_TOKEN,
        'Accept': 'application/xml',
        'User-Agent': 'GameNightMadness/1.0 (group game picker)'
      }});
    } catch (e) {
      return reply('Could not reach BoardGameGeek.', 502);
    }
    const body = await up.text();
    const extra = {'X-GNM-Cache': 'miss'};
    const ra = up.headers.get('Retry-After');
    if (ra) extra['Retry-After'] = ra;

    // Only cache real answers: not "queued" (202), not errors, not throttling.
    const good = up.status === 200 && /<items[\s>]/.test(body.slice(0, 2000)) && !/<errors?[\s>]/.test(body.slice(0, 500));
    if (good) {
      const ttl = TTL[kind];
      try {
        const save = env.CACHE
          ? env.CACHE.put(cacheKey, body, {expirationTtl: ttl})
          : caches.default.put(new Request('https://gnm-cache.invalid/' + encodeURIComponent(cacheKey)),
              new Response(body, {headers: {'Content-Type': 'text/xml; charset=utf-8', 'Cache-Control': 'public, max-age=' + ttl}}));
        ctx.waitUntil(Promise.resolve(save).catch(() => {}));
      } catch (e) { /* caching is a bonus; the answer still goes back */ }
    }
    return reply(body, up.status, xml(extra));
  }
};
