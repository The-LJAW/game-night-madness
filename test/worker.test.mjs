// Tests for bgg-helper/worker.js with a fake BoardGameGeek and fake caches (run: node test/worker.test.mjs)
import assert from 'node:assert/strict';
import fs from 'node:fs';
// Cloudflare runs worker.js as a module; Node needs the .mjs extension to do the same.
const copy = new URL('./.worker.mjs', import.meta.url);
fs.copyFileSync(new URL('../bgg-helper/worker.js', import.meta.url), copy);
const {default: worker} = await import(copy.href);

const calls = [];
let nextReply = {status: 200, body: '<?xml version="1.0"?><items totalitems="1"><item objectid="13"/></items>'};
globalThis.fetch = async (url, init) => {
  calls.push({url: String(url), auth: init && init.headers && init.headers['Authorization']});
  return new Response(nextReply.body, {status: nextReply.status, headers: nextReply.headers || {}});
};
const edge = new Map();
globalThis.caches = {default: {
  match: async req => (edge.has(req.url) ? new Response(edge.get(req.url)) : undefined),
  put: async (req, res) => { edge.set(req.url, await res.text()); }
}};
const waits = [];
const ctx = {waitUntil: p => waits.push(p)};
const ORIGIN = 'https://the-ljaw.github.io';
const env = {BGG_TOKEN: 'tok123', ALLOWED_ORIGINS: 'https://the-ljaw.github.io, http://localhost:8765'};
const get = (path, headers = {Origin: ORIGIN}, e = env, method = 'GET') =>
  worker.fetch(new Request('https://gnm-bgg.example.workers.dev' + path, {method, headers}), e, ctx);
let passed = 0;
const t = async (name, fn) => { await fn(); passed++; console.log('ok -', name); };

await t('preflight answers with CORS for the allowed site', async () => {
  const r = await get('/collection?username=x', {Origin: ORIGIN}, env, 'OPTIONS');
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.match(r.headers.get('Access-Control-Expose-Headers'), /Retry-After/);
});
await t('status page says what is set up, never the token', async () => {
  const r = await get('/', {});
  assert.equal(r.status, 200);
  const txt = await r.text();
  assert.match(txt, /BGG helper: running/);
  assert.match(txt, /BGG token: set/);
  assert.doesNotMatch(txt, /tok123/);
  assert.match(txt, /Cache: no KV bound/);
  assert.match(txt, /Allowed sites: https:\/\/the-ljaw\.github\.io, http:\/\/localhost:8765/);
  const bare = await (await get('/', {}, {})).text();
  assert.match(bare, /BGG token: not set yet/);
  assert.match(bare, /Allowed sites: https:\/\/the-ljaw\.github\.io\n/, 'default site when ALLOWED_ORIGINS is not set');
  const kv = await (await get('/', {}, {BGG_TOKEN: 'x', CACHE: {}})).text();
  assert.match(kv, /Cache: KV namespace bound as CACHE/);
});
await t('a cache that throws never breaks the answer', async () => {
  const saved = globalThis.caches;
  globalThis.caches = {default: {match: () => { throw new Error('no cache here'); }, put: () => { throw new Error('no cache here'); }}};
  try {
    nextReply = {status: 200, body: '<items><item type="boardgame" id="822"/></items>'};
    const r = await get('/thing?id=822');
    assert.equal(r.status, 200); assert.match(await r.text(), /id="822"/);
  } finally { globalThis.caches = saved; nextReply = {status: 200, body: '<?xml version="1.0"?><items totalitems="1"><item objectid="13"/></items>'}; }
});
await t('refuses calls without an allowed Origin', async () => {
  assert.equal((await get('/collection?username=levi', {})).status, 403);
  assert.equal((await get('/collection?username=levi', {Origin: 'https://evil.example'})).status, 403);
});
await t('second allowed origin works (localhost testing)', async () => {
  const r = await get('/collection?username=levi', {Origin: 'http://localhost:8765'});
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), 'http://localhost:8765');
});
await t('says clearly when the token is missing', async () => {
  const r = await get('/collection?username=levi', {Origin: ORIGIN}, {ALLOWED_ORIGINS: ORIGIN});
  assert.equal(r.status, 503); assert.equal(r.headers.get('X-GNM-Error'), 'no-token');
});
await t('rejects odd usernames and unknown paths', async () => {
  assert.equal((await get('/collection?username=' + encodeURIComponent('<script>'))).status, 400);
  assert.equal((await get('/collection?username=')).status, 400);
  assert.equal((await get('/hot')).status, 404);
  assert.equal((await get('/search?query=catan')).status, 404);
});
await t('collection call goes to BGG with the token and fixed filters', async () => {
  calls.length = 0; edge.clear();
  const r = await get('/collection?username=Some%20User');
  assert.equal(r.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://boardgamegeek.com/xmlapi2/collection?username=Some%20User&own=1&stats=1&subtype=boardgame&excludesubtype=boardgameexpansion');
  assert.equal(calls[0].auth, 'Bearer tok123');
  assert.equal(r.headers.get('X-GNM-Cache'), 'miss');
  assert.match(r.headers.get('Content-Type'), /xml/);
});
await t('a good answer is cached and served from cache next time', async () => {
  await Promise.all(waits);
  calls.length = 0;
  const r = await get('/collection?username=some%20user');
  assert.equal(r.status, 200); assert.equal(calls.length, 0, 'should not call BGG again');
  assert.equal(r.headers.get('X-GNM-Cache'), 'hit');
});
await t('a queued (202) collection is passed through and not cached', async () => {
  edge.clear(); calls.length = 0;
  nextReply = {status: 202, body: '<message>Your request for this collection has been accepted and will be processed.  Please try again later for access.</message>'};
  const r = await get('/collection?username=newbie');
  assert.equal(r.status, 202);
  await Promise.all(waits);
  assert.equal(edge.size, 0);
});
await t('BGG errors (bad username) are passed through and not cached', async () => {
  edge.clear();
  nextReply = {status: 200, body: '<errors><error><message>Invalid username specified</message></error></errors>'};
  const r = await get('/collection?username=nobody_here');
  assert.equal(r.status, 200); assert.match(await r.text(), /Invalid username/);
  await Promise.all(waits);
  assert.equal(edge.size, 0);
});
await t('throttling (429) keeps Retry-After', async () => {
  nextReply = {status: 429, body: 'Too many requests', headers: {'Retry-After': '5'}};
  const r = await get('/thing?id=13');
  assert.equal(r.status, 429); assert.equal(r.headers.get('Retry-After'), '5');
});
await t('thing: ids are cleaned, de-duplicated, sorted, and capped at 20', async () => {
  nextReply = {status: 200, body: '<items><item type="boardgame" id="13"/></items>'};
  calls.length = 0;
  const r = await get('/thing?id=822,13,13,abc,9209');
  assert.equal(r.status, 200);
  assert.equal(calls[0].url, 'https://boardgamegeek.com/xmlapi2/thing?stats=1&id=13,822,9209');
  const ids21 = Array.from({length: 21}, (_, i) => i + 1).join(',');
  assert.equal((await get('/thing?id=' + ids21)).status, 400);
  assert.equal((await get('/thing?id=abc')).status, 400);
});
await t('uses KV when a CACHE namespace is bound', async () => {
  const kv = new Map();
  const envKV = Object.assign({}, env, {CACHE: {get: async k => kv.get(k) || null, put: async (k, v, o) => { kv.set(k, v); assert.equal(o.expirationTtl, 7 * 24 * 3600); }}});
  calls.length = 0;
  await get('/thing?id=13', {Origin: ORIGIN}, envKV);
  await Promise.all(waits);
  assert.equal(kv.size, 1);
  const r = await get('/thing?id=13', {Origin: ORIGIN}, envKV);
  assert.equal(r.headers.get('X-GNM-Cache'), 'hit'); assert.equal(calls.length, 1);
});

/* ---------- /check: does BGG accept the token? ---------- */
const CATAN = '<?xml version="1.0" encoding="utf-8"?><items termsofuse="https://boardgamegeek.com/xmlapi/termsofuse"><item type="boardgame" id="13"><name type="primary" sortindex="1" value="CATAN"/><name type="alternate" sortindex="1" value="Settlers"/></item></items>';
await t('status page points to /check and keeps the line the app reads', async () => {
  const txt = await (await get('/', {}, {BGG_TOKEN: 'abc'})).text();
  assert.match(txt, /open \/check/);
  assert.equal((/BGG token: (set|not set)/.exec(txt) || [])[1], 'set', 'the app reads the first "BGG token:" line');
  const none = await (await get('/', {}, {BGG_TOKEN: '   '})).text();
  assert.equal((/BGG token: (set|not set)/.exec(none) || [])[1], 'not set', 'a token of only spaces counts as not set');
});
await t('check: no token yet', async () => {
  calls.length = 0;
  const txt = await (await get('/check', {}, {})).text();
  assert.match(txt, /no token yet/); assert.equal(calls.length, 0);
});
await t('check: BGG accepts the token (no Origin needed, token trimmed, result reused)', async () => {
  calls.length = 0;
  nextReply = {status: 200, body: CATAN};
  const e = {BGG_TOKEN: '  tokGood123 \n'};
  const r = await get('/check', {}, e);
  assert.equal(r.status, 200);
  const txt = await r.text();
  assert.match(txt, /^BGG check: OK\. BoardGameGeek accepted the token and sent back CATAN\./);
  assert.match(txt, /Checked: \d{4}-\d\d-\d\d \d\d:\d\d UTC/);
  assert.doesNotMatch(txt, /tokGood123/);
  assert.doesNotMatch(txt, /Note:/, 'spaces only around the token are fine');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://boardgamegeek.com/xmlapi2/thing?id=13');
  assert.equal(calls[0].auth, 'Bearer tokGood123');
  await get('/check', {}, e);
  assert.equal(calls.length, 1, 'a second look within 5 minutes reuses the result');
});
await t('check: a refused token says how to fix it, and a new token is checked right away', async () => {
  calls.length = 0;
  nextReply = {status: 401, body: '<html><body><h1>401 Unauthorized</h1></body></html>'};
  const txt = await (await get('/check', {}, {BGG_TOKEN: 'tokBad'})).text();
  assert.match(txt, /refused the request \(HTTP 401\)/);
  assert.match(txt, /Fix: copy the token again/);
  assert.match(txt, /BGG said: 401 Unauthorized/);
  nextReply = {status: 200, body: CATAN};
  const again = await (await get('/check', {}, {BGG_TOKEN: 'tokFixed'})).text();
  assert.match(again, /OK\./); assert.equal(calls.length, 2);
});
await t('check: busy BGG, odd answers, and unreachable BGG', async () => {
  nextReply = {status: 503, body: 'Service Unavailable'};
  assert.match(await (await get('/check', {}, {BGG_TOKEN: 'tokBusy'})).text(), /busy right now \(HTTP 503\)/);
  nextReply = {status: 200, body: '<html><title>Just a moment...</title><body>Enable JavaScript and cookies to continue</body></html>'};
  const odd = await (await get('/check', {}, {BGG_TOKEN: 'tokOdd'})).text();
  assert.match(odd, /answered \(HTTP 200\), but not with game data/);
  assert.match(odd, /BGG said: Just a moment\.\.\. Enable JavaScript and cookies to continue/);
  const saved = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('network down'); };
  try { assert.match(await (await get('/check', {}, {BGG_TOKEN: 'tokNet'})).text(), /could not reach BoardGameGeek/); }
  finally { globalThis.fetch = saved; nextReply = {status: 200, body: CATAN}; }
});
await t('check: a token with a space inside gets a note', async () => {
  const txt = await (await get('/check', {}, {BGG_TOKEN: 'tok part2'})).text();
  assert.match(txt, /Note: the saved token has a space or line break inside it/);
});
await t('check: results are kept in KV, 5 minutes after success and 1 minute after failure', async () => {
  const kv = new Map(), ttls = [];
  const envKV = tok => ({BGG_TOKEN: tok, CACHE: {get: async k => kv.get(k) || null, put: async (k, v, o) => { kv.set(k, v); ttls.push(o.expirationTtl); }}});
  nextReply = {status: 200, body: CATAN};
  await get('/check', {}, envKV('tokKV1'));
  nextReply = {status: 403, body: 'Forbidden'};
  await get('/check', {}, envKV('tokKV2'));
  await Promise.all(waits);
  assert.deepEqual(ttls, [300, 60]);
  const stored = [...kv.values()].map(v => JSON.parse(v));
  assert.ok(stored.every(s => !JSON.stringify(s).includes('tokKV')), 'the token is never stored');
  nextReply = {status: 200, body: CATAN};
});
await t('main lookups send the trimmed token', async () => {
  calls.length = 0; edge.clear();
  nextReply = {status: 200, body: '<items><item type="boardgame" id="9209"/></items>'};
  await get('/thing?id=9209', {Origin: ORIGIN}, {BGG_TOKEN: ' tokTrim \n', ALLOWED_ORIGINS: ORIGIN});
  assert.equal(calls[0].auth, 'Bearer tokTrim');
  const r = await get('/thing?id=9209', {Origin: ORIGIN}, {BGG_TOKEN: '  ', ALLOWED_ORIGINS: ORIGIN});
  assert.equal(r.status, 503, 'a blank token counts as not set');
});
console.log(`\n${passed} worker tests passed`);
