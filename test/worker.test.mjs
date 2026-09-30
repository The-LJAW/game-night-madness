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
await t('health check', async () => {
  const r = await get('/', {});
  assert.equal(r.status, 200); assert.equal(await r.text(), 'ok');
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
console.log(`\n${passed} worker tests passed`);
