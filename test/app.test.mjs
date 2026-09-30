// Real-browser tests for Game Night Madness (run: node test/app.test.mjs [--shots])
// A fake BGG helper and a fake ntfy relay run inside Playwright, so two "phones" can play a full bracket.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {createRequire} from 'node:module';
import {collectionXML, thingXML, EXPANSION_ITEM, PREVOWNED_ITEM, QUEUED, BAD_USER, SAMPLE_ROWS, thumb} from './fixtures.mjs';

const require = createRequire(import.meta.url);
function loadPlaywright() {
  for (const p of ['playwright', process.env.PLAYWRIGHT_MODULE, '/home/claude/.npm-global/lib/node_modules/playwright'].filter(Boolean)) {
    try { return require(p); } catch (e) {}
  }
  throw new Error('Playwright not found: npm install playwright (or set PLAYWRIGHT_MODULE)');
}
const {chromium} = loadPlaywright();
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIST = ROOT; // index.html and preview.html are built into the repo root
const SHOTS = process.argv.includes('--shots');
const SHOT_DIR = path.join(ROOT, 'test', 'shots');
if (SHOTS) fs.mkdirSync(SHOT_DIR, {recursive: true});
// Optional: the two fonts from @fontsource, so screenshots look like the real thing (npm i @fontsource/barlow @fontsource/big-shoulders-display)
const FONTS = process.env.GNM_FONTS || '/home/claude/work/fonts/node_modules/@fontsource';

/* ---------- static server for dist/ ---------- */
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  let p = decodeURIComponent(u.pathname);
  if (p === '/') p = '/index.html';
  const f = path.join(DIST, p);
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('nope'); return; }
  res.writeHead(200, {'Content-Type': f.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream'});
  res.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(8765, r));
const BASE = 'http://localhost:8765/';

/* ---------- fakes ---------- */
const USER_IDS = SAMPLE_ROWS.map(r => r[0]).filter((id, i) => i % 5 !== 4); // most of the sample shelf
const dupItem = collectionXML({ids: [13]}).match(/<item [\s\S]*?<\/item>/)[0];
const bgg = {collectionCalls: {}, thingCalls: [], maxIds: 0};
async function fakeBgg(route) {
  const u = new URL(route.request().url());
  const h = {'Access-Control-Allow-Origin': '*', 'Content-Type': 'text/xml; charset=utf-8'};
  if (u.pathname === '/collection') {
    const user = u.searchParams.get('username');
    const n = bgg.collectionCalls[user] = (bgg.collectionCalls[user] || 0) + 1;
    if (user === 'nobody') return route.fulfill({status: 200, headers: h, body: BAD_USER});
    if (user === 'emptyshelf') return route.fulfill({status: 200, headers: h, body: collectionXML({ids: []})});
    if (user === 'notoken') return route.fulfill({status: 503, headers: Object.assign({}, h, {'X-GNM-Error': 'no-token', 'Access-Control-Expose-Headers': 'X-GNM-Error'}), body: 'no token'});
    if (n === 1) return route.fulfill({status: 202, headers: h, body: QUEUED});
    return route.fulfill({status: 200, headers: h, body: collectionXML({ids: USER_IDS, rating: {13: 'N/A'}, notRanked: [240980], extra: EXPANSION_ITEM + '\n' + PREVOWNED_ITEM + '\n' + dupItem})});
  }
  if (u.pathname === '/thing') {
    const ids = u.searchParams.get('id').split(',').map(Number);
    bgg.thingCalls.push(ids); bgg.maxIds = Math.max(bgg.maxIds, ids.length);
    if (bgg.thingCalls.length === 2 && !bgg.throttled) { bgg.throttled = true; return route.fulfill({status: 429, headers: Object.assign({}, h, {'Retry-After': '1'}), body: 'slow down'}); }
    return route.fulfill({status: 200, headers: h, body: thingXML(ids)});
  }
  return route.fulfill({status: 404, headers: h, body: 'not found'});
}
const topics = {};
let seq = 0;
async function fakeNtfy(route) {
  const req = route.request(), u = new URL(req.url());
  const parts = u.pathname.split('/').filter(Boolean), topic = parts[0], list = topics[topic] = topics[topic] || [];
  const h = {'Access-Control-Allow-Origin': '*'};
  if (req.method() === 'POST') {
    const m = {id: 'm' + (++seq).toString(36) + Math.random().toString(36).slice(2, 6), time: Math.floor(Date.now() / 1000), event: 'message', topic, message: req.postData()};
    list.push(m);
    return route.fulfill({status: 200, headers: Object.assign({'Content-Type': 'application/json'}, h), body: JSON.stringify(m)});
  }
  if (parts[1] === 'json') return route.fulfill({status: 200, headers: Object.assign({'Content-Type': 'application/x-ndjson'}, h), body: list.map(m => JSON.stringify(m)).join('\n') + '\n'});
  if (parts[1] === 'sse') return route.fulfill({status: 200, headers: Object.assign({'Content-Type': 'text/event-stream'}, h), body: 'retry: 400\n\n' + list.map(m => 'data: ' + JSON.stringify(m) + '\n\n').join('')});
  return route.fulfill({status: 404, headers: h, body: ''});
}
const fontCSS = [['Barlow', 'barlow/files/barlow-latin', [400, 500, 600, 700]], ['Big Shoulders Display', 'big-shoulders-display/files/big-shoulders-display-latin', [700, 800, 900]]]
  .map(([fam, base, ws]) => ws.map(w => `@font-face{font-family:"${fam}";font-weight:${w};font-style:normal;src:url(https://fonts.gstatic.com/${base}-${w}-normal.woff2) format("woff2")}`).join('\n')).join('\n');
async function wire(ctx, cfg) {
  await ctx.route('https://bgg.test/**', fakeBgg);
  await ctx.route('https://ntfy.test/**', fakeNtfy);
  await ctx.route('https://fonts.googleapis.com/**', r => r.fulfill({status: 200, headers: {'Content-Type': 'text/css'}, body: fontCSS}));
  await ctx.route('https://fonts.gstatic.com/**', r => {
    const f = path.join(FONTS, new URL(r.request().url()).pathname.slice(1));
    return fs.existsSync(f) ? r.fulfill({status: 200, headers: {'Content-Type': 'font/woff2', 'Access-Control-Allow-Origin': '*'}, body: fs.readFileSync(f)}) : r.abort();
  });
  const hues = [262, 18, 145, 205, 40, 330, 95];
  await ctx.route('https://cf.geekdo-images.com/**', r => {
    const id = +(r.request().url().match(/pic(\d+)/) || [0, 1])[1];
    if (id === 12333) return r.fulfill({status: 404, body: ''}); // one broken image: the letter should show instead
    const hue = hues[id % hues.length];
    return r.fulfill({status: 200, headers: {'Content-Type': 'image/svg+xml'}, body: `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150"><rect width="200" height="150" fill="hsl(${hue},55%,45%)"/><rect x="20" y="20" width="160" height="110" rx="10" fill="hsl(${hue},60%,70%)"/><circle cx="100" cy="75" r="26" fill="hsl(${hue},50%,30%)"/></svg>`});
  });
  await ctx.route('https://*.posthog.com/**', r => r.abort());
  await ctx.addInitScript(c => { window.GNM_CONFIG = c; window.GNM_TEST = true; }, cfg || {bggProxy: 'https://bgg.test', ntfy: 'https://ntfy.test'});
}

const browser = await chromium.launch();
const errors = [];
async function phone(opts) {
  const ctx = await browser.newContext(Object.assign({viewport: {width: 390, height: 844}, deviceScaleFactor: 2, hasTouch: true, isMobile: true}, opts || {}));
  await wire(ctx, opts && opts.cfg);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::/.test(m.text())) errors.push('console: ' + m.text()); });
  return {ctx, page};
}
let passed = 0;
async function t(name, fn) { const t0 = Date.now(); await fn(); passed++; console.log('ok -', name, '(' + ((Date.now() - t0) / 1000).toFixed(1) + 's)'); }
async function shot(page, name, full) { if (SHOTS) await page.screenshot({path: path.join(SHOT_DIR, name + '.png'), fullPage: !!full}); }
const visible = (page, sel) => page.locator(sel).isVisible();

/* ============ 1. logic checks inside the page ============ */
await t('parsing, types, filters and message size', async () => {
  const {ctx, page} = await phone();
  await page.goto(BASE);
  const r = await page.evaluate(({col, thing, bad, queued}) => {
    const G = window.GNM, out = {};
    const games = G.parseCollection(col);
    out.count = games.length;
    out.ids = games.map(g => g.id);
    out.catan = games.find(g => g.id === 13);
    out.clock = games.find(g => g.id === 240980);
    const map = G.parseThings(thing);
    out.pandemic = map[30549];
    out.cartoFams = map[263918].f;
    try { G.parseCollection(bad); } catch (e) { out.badCode = e.code; }
    try { G.parseCollection(queued); } catch (e) { out.queuedCode = e.code; }
    const S = G.sampleShelf(), by = Object.fromEntries(S.map(g => [g.n, g]));
    const ty = n => G.typesOf(by[n]);
    out.types = {pandemic: ty('Pandemic'), codenames: ty('Codenames'), avalon: ty('The Resistance: Avalon'), carto: ty('Cartographers'),
      croki: ty('Crokinole'), ts: ty('Twilight Struggle'), magic: ty('Magic: The Gathering'), tele: ty('Telestrations'), quacks: ty('The Quacks of Quedlinburg')};
    out.verdict = {catan4: G.verdict(by['CATAN'], 4), catan3: G.verdict(by['CATAN'], 3), codenames2: G.verdict(by['Codenames'], 2), wingspan5: G.verdict(by['Wingspan'], 5)};
    const q = {n: 6, tm: 30, wk: 1, hv: 0, sh: 0};
    out.fit6x30 = S.filter(g => G.fitsBasic(g, q) && G.fitsMore(g, q)).map(g => g.n).sort();
    const q2 = {n: 4, tm: 0, wk: 0, hv: 1, sh: 1};
    out.shame = S.filter(g => G.fitsBasic(g, q2) && G.fitsMore(g, q2)).map(g => g.n).sort();
    // worst-case message: 16 games with long names and thumbnails
    const long = Array.from({length: 16}, (_, i) => G.gameItem({id: 100000 + i, n: 'Twilight Imperium: Fourth Edition – Prophecy of Kings Deluxe ' + i, im: 'Hash' + i + 'Abc__thumb/img/Sig' + i + 'xyz=/fit-in/200x150/filters:strip_icc()/pic' + (123456 + i) + '.jpg', p0: 3, p1: 8, t: 480, w: 4.3, b: 1}, 6));
    const def = G.defFrom(1, 'game', long, {mode: 'one', lens: 'play', title: 'Game Showdown', tb: 'coin', cx: {n: 6, tm: 0, sample: 0}, q: {u: 'someone_with_a_long_name', sample: 0, n: 6, tm: 0, wk: 1, hv: 0, sh: 0}});
    out.defBytes = new Blob([JSON.stringify(def)]).size;
    const normal = S.slice(0, 16).map(g => G.gameItem(Object.assign(G.shelfItem(g, 4), {im: 'Hash' + g.id + 'Abc__thumb/img/Sig' + g.id + 'xyz=/fit-in/200x150/filters:strip_icc()/pic' + g.id + '.jpg'}), 4));
    const def2 = G.defFrom(2, 'game', normal, {mode: 'two', lens: 'play', title: 'X Showdown', tb: 'coin', cx: {n: 4, tm: 90, sample: 0}, q: {u: 'levitest', sample: 0, n: 4, tm: 90, wk: 1, hv: 0, sh: 0}});
    out.def2Bytes = new Blob([JSON.stringify(def2)]).size; out.def2KeepsImages = def2.ents.every(e => e.im);
    out.imgOk = G.imgURL('Hash1__thumb/img/abc=/fit-in/200x150/filters:strip_icc()/pic1.jpg');
    out.imgBad = [G.imgURL('//evil.example/x.jpg'), G.imgURL('a"onerror="x'), G.imgURL('javascript:alert(1)')];
    return out;
  }, {col: collectionXML({ids: USER_IDS, rating: {13: 'N/A'}, notRanked: [240980], extra: EXPANSION_ITEM + PREVOWNED_ITEM + dupItem}), thing: thingXML([30549, 263918]), bad: BAD_USER, queued: QUEUED});
  assert.equal(r.count, USER_IDS.length, 'owned base games only, duplicates merged');
  assert.ok(!r.ids.includes(926), 'expansion left out');
  assert.ok(!r.ids.includes(2651), 'previously owned left out');
  assert.equal(r.catan.ur, 0, 'N/A rating becomes 0');
  assert.equal(r.catan.im, thumb(13).replace('https://cf.geekdo-images.com/', ''));
  assert.deepEqual(r.catan.sub.sort(), ['family', 'strategy']);
  assert.equal(r.catan.p0, 3); assert.equal(r.catan.t, 120); assert.equal(r.catan.pl, 12);
  assert.deepEqual(r.clock.sub, ['party'], 'Not Ranked still counts as a BGG type');
  assert.equal(r.pandemic.w, 2.4);
  assert.ok(r.pandemic.m.includes('Cooperative Game'));
  assert.deepEqual(r.pandemic.np['4'], [60, 35, 5]);
  assert.ok(!('4+' in r.pandemic.np) && r.pandemic.np['2'], 'the "N+" poll row is ignored');
  assert.deepEqual(r.cartoFams, ['Mechanism: Flip-and-Write'], 'only Mechanism families kept');
  assert.equal(r.badCode, 'nouser'); assert.equal(r.queuedCode, 'queued');
  const T = r.types;
  for (const k of ['coop', 'family', 'strategy']) assert.ok(T.pandemic.includes(k), 'pandemic ' + k);
  for (const k of ['party', 'card', 'words', 'filler', 'mystery']) assert.ok(T.codenames.includes(k), 'codenames ' + k);
  for (const k of ['deduction', 'party', 'bluff', 'fantasy', 'history']) assert.ok(T.avalon.includes(k), 'avalon ' + k);
  for (const k of ['write', 'card', 'fantasy']) assert.ok(T.carto.includes(k), 'cartographers ' + k);
  for (const k of ['dexterity', 'abstract', 'sports']) assert.ok(T.croki.includes(k), 'crokinole ' + k);
  for (const k of ['war', 'heavy', 'duel', 'history', 'strategy']) assert.ok(T.ts.includes(k), 'twilight struggle ' + k);
  for (const k of ['cgs', 'card', 'fantasy', 'filler']) assert.ok(T.magic.includes(k), 'magic ' + k);
  assert.ok(!T.tele.includes('write'), 'a drawing game is not a roll & write');
  assert.ok(T.quacks.includes('deck') && T.quacks.includes('luck'), 'bag builder counts as deck builder');
  assert.deepEqual(r.verdict, {catan4: 'best', catan3: 'ok', codenames2: 'weak', wingspan5: 'ok'});
  assert.deepEqual(r.fit6x30, ['7 Wonders', 'Camel Up', 'Codenames', 'Coup', 'Dixit', 'Just One', 'King of Tokyo', 'Telestrations', 'The Resistance: Avalon'], JSON.stringify(r.fit6x30));
  assert.deepEqual(r.shame, ['Captain Sonar', 'Tichu'], 'shelf of shame + skip heavy + 4 players: ' + JSON.stringify(r.shame));
  assert.ok(r.defBytes <= 3900, 'worst-case bracket message fits ntfy: ' + r.defBytes);
  assert.ok(r.def2Bytes <= 3900 && r.def2KeepsImages, 'a normal 16-game bracket keeps its pictures: ' + r.def2Bytes);
  assert.ok(r.imgOk.startsWith('https://cf.geekdo-images.com/'));
  assert.deepEqual(r.imgBad, ['', '', '']);
  await ctx.close();
});

/* ============ 2. errors on the setup screen ============ */
await t('setup errors: unknown user, empty shelf, nothing fits, helper without token', async () => {
  const {ctx, page} = await phone();
  await page.goto(BASE);
  assert.ok(await visible(page, '#shelf-bgg'), 'BGG username box shows when the helper is set');
  await page.fill('#bgg-user', 'nobody'); await page.click('#btn-find');
  await page.waitForSelector('#find-err:not([hidden])');
  assert.match(await page.textContent('#find-err'), /couldn’t find a BGG user named “nobody”/);
  await page.fill('#bgg-user', 'emptyshelf'); await page.click('#btn-find');
  await page.waitForFunction(() => /no games marked Owned/.test(document.querySelector('#find-err').textContent));
  await page.fill('#bgg-user', 'notoken'); await page.click('#btn-find');
  await page.waitForFunction(() => /isn’t switched on yet/.test(document.querySelector('#find-err').textContent));
  await page.fill('#bgg-user', 'levitest');
  await page.click('#players button[data-n="8"]'); await page.click('#times button[data-m="30"]'); await page.check('#f-sh', {force: true});
  await page.click('#btn-find');
  await page.waitForFunction(() => /None of the \d+ owned games fit 8\+ players/.test(document.querySelector('#find-err').textContent), null, {timeout: 30000});
  assert.equal(bgg.collectionCalls.levitest, 2, 'one queued (202) answer, then the real one');
  // switching to the sample shelf from the error box
  await page.click('#btn-src');
  assert.ok(await visible(page, '#shelf-sample'));
  await ctx.close();
});

/* ============ 3. full game night on two phones ============ */
let code;
const host = await phone(), guest = await phone();
const H = host.page, Gp = guest.page;
async function pickAll(page, choose) {
  const mus = page.locator('#vote-main .mu:not(.bye)');
  const n = await mus.count();
  for (let i = 0; i < n; i++) {
    const opts = mus.nth(i).locator('button.mu-o');
    await opts.nth(choose ? choose(i) : 0).click();
  }
  await page.waitForSelector('#lock-btn:not([disabled])');
  await page.click('#lock-btn');
}
async function waitTitle(page, re) { await page.waitForFunction(r => new RegExp(r).test(document.querySelector('#room-title').textContent), re.source, {timeout: 20000}); }
async function skipFlips(page) { if (await page.locator('#flip:not([hidden])').count()) await page.click('#flip-skip'); }

await t('organizer loads a BGG shelf (throttled once, batches of 20)', async () => {
  await H.goto(BASE);
  await shot(H, '01-setup', true);
  await H.fill('#bgg-user', 'levitest');
  await H.click('#btn-find');
  await H.waitForSelector('#v-build:not([hidden])', {timeout: 40000});
  const eyebrow = await H.textContent('#build-eyebrow');
  assert.match(eyebrow, /^\d+ of \d+ games fit 4 players, up to 90 min$/);
  assert.ok(bgg.maxIds <= 20, 'never more than 20 ids per detail call: ' + bgg.maxIds);
  assert.ok(bgg.throttled, 'the throttled batch was retried');
  const n = await H.locator('#picker .pk-row').count();
  assert.ok(n >= 10, 'lots of game types to pick from: ' + n);
  assert.equal(await H.locator('#picker .pk-row.on').count(), 8, '8 types seeded by default');
  const labels = await H.locator('#picker .pk-row b').allTextContents();
  assert.ok(labels.includes('Co-op') && labels.includes('Card games'), labels.join(', '));
  assert.ok(!labels.includes('Two-player duels'), 'duels can not seat 4');
  await shot(H, '02-build-types', true);
  // theme lens and games-only mode render too
  await H.click('#lens button[data-lens="theme"]');
  assert.ok((await H.locator('#picker .pk-row b').allTextContents()).includes('Fantasy'));
  await H.click('.mode[data-mode="one"]');
  await H.waitForSelector('#picker .pk-row .th img');
  assert.equal(await H.locator('#picker .pk-row.on').count(), 8);
  await H.selectOption('#cat-sel', 'play:coop');
  const coop = await H.locator('#picker .pk-row b').allTextContents();
  assert.ok(coop.includes('Pandemic') && !coop.includes('Codenames'), coop.join(', '));
  await shot(H, '03-build-games', true);
  await H.click('.mode[data-mode="two"]'); await H.click('#lens button[data-lens="play"]');
  await H.fill('#host-name', 'Levi');
  await H.click('#btn-create');
  await H.waitForSelector('#v-room:not([hidden])');
  code = new URL(H.url()).searchParams.get('b');
  assert.match(code, /^[a-z0-9]{8}$/);
  assert.equal(await H.textContent('#room-title'), 'The lobby');
});

await t('a friend joins from the link and sees the field', async () => {
  await Gp.goto(BASE + '?b=' + code + '&via=qr');
  await Gp.waitForSelector('#v-join:not([hidden])', {timeout: 15000});
  assert.equal(await Gp.textContent('#join-title'), 'Game Type Showdown');
  assert.match(await Gp.textContent('#join-where'), /Games from Levi’s shelf for 4 players, up to 90 min/);
  assert.equal(await Gp.locator('#join-ents li').count(), 8);
  await shot(Gp, '04-join', true);
  await Gp.fill('#join-name', 'Beth'); await Gp.click('#btn-join');
  await Gp.waitForSelector('#v-room:not([hidden])');
  await H.waitForFunction(() => document.querySelector('#tab-n').textContent === '2', null, {timeout: 15000});
  await shot(H, '05-lobby', true);
});

let flipTexts;
await t('stage 1: voting, a tie settled by the same coin flip on both phones', async () => {
  await H.click('[data-act="start"]');
  await waitTitle(H, /Quarterfinals/); await waitTitle(Gp, /Quarterfinals/);
  await shot(Gp, '06-voting', false);
  await pickAll(H);
  await pickAll(Gp, i => (i === 0 ? 1 : 0)); // disagree on matchup 1 -> 1-1 tie
  await H.waitForSelector('#flip:not([hidden])', {timeout: 15000});
  await Gp.waitForSelector('#flip:not([hidden])', {timeout: 15000});
  await H.waitForFunction(() => document.querySelector('#flip-result').textContent.length > 0, null, {timeout: 10000});
  await Gp.waitForFunction(() => document.querySelector('#flip-result').textContent.length > 0, null, {timeout: 10000});
  flipTexts = [await H.textContent('#flip-result'), await Gp.textContent('#flip-result')];
  assert.equal(flipTexts[0], flipTexts[1], 'same flip everywhere');
  await shot(H, '07-coin-flip', false);
  await skipFlips(H); await skipFlips(Gp);
  await waitTitle(H, /Semifinals/); await waitTitle(Gp, /Semifinals/);
  assert.match(await H.textContent('#vote-main .results'), /won the coin flip/);
  await pickAll(H); await pickAll(Gp);
  await waitTitle(H, /The Final/);
  await pickAll(H); await pickAll(Gp);
  await waitTitle(H, / wins$/); await waitTitle(Gp, / wins$/);
});

let typeName;
await t('stage 2: organizer seeds that type’s games, everyone plays it out', async () => {
  typeName = (await H.textContent('#room-title')).replace(/ wins$/, '');
  assert.match(await Gp.textContent('#vote-main'), new RegExp('picking which ' + typeName + ' games make the final bracket'));
  await H.waitForSelector('#s2-picker .pk-row', {timeout: 15000});
  const inS2 = await H.locator('#s2-picker .pk-row').count();
  assert.ok(inS2 >= 1);
  await shot(H, '08-stage2-picker', true);
  await H.click('#s2-go');
  await waitTitle(H, /Quarterfinals|Semifinals|The Final|Opening round/);
  await waitTitle(Gp, /Quarterfinals|Semifinals|The Final|Opening round/);
  assert.equal(await H.textContent('#room-eyebrow'), 'Stage 2 of 2 · Pick the game');
  assert.ok(await H.locator('#vote-main .mu-o .th').count() > 0, 'games show box art');
  await shot(Gp, '09-stage2-voting', false);
  for (let round = 0; round < 4; round++) {
    if (/Game on/.test(await H.textContent('#room-title'))) break;
    const before = await H.textContent('#room-title');
    await pickAll(H); await pickAll(Gp);
    await H.waitForFunction(b => document.querySelector('#room-title').textContent !== b, before, {timeout: 20000});
    await skipFlips(H); await skipFlips(Gp);
  }
  await waitTitle(H, /Game on/); await waitTitle(Gp, /Game on/);
  const champH = await H.textContent('.champ-n'), champG = await Gp.textContent('.champ-n');
  assert.equal(champH, champG);
  const how = await Gp.getAttribute('[data-wa="how_to_play"]', 'href');
  assert.ok(how.startsWith('https://www.youtube.com/results?search_query=how%20to%20play%20'));
  assert.match(await Gp.getAttribute('[data-wa="bgg"]', 'href'), /^https:\/\/boardgamegeek\.com\/boardgame\/\d+$/);
  await Gp.waitForTimeout(3200); // let the confetti settle
  await shot(Gp, '10-winner', true);
  await H.click('#t-bracket');
  assert.equal(await H.locator('#bk-box [data-bk]').count(), 2, 'both brackets on the Bracket tab');
  await shot(H, '11-bracket-tab', false);
});
await host.ctx.close(); await guest.ctx.close();

/* ============ 4. preview build: sample shelf on one phone ============ */
await t('preview page: sample shelf, pass-the-phone voting to a winner', async () => {
  const {ctx, page} = await phone({cfg: {}});
  await page.goto(BASE + 'preview.html');
  assert.ok(await visible(page, '#preview-banner'));
  assert.ok(await visible(page, '#shelf-sample'));
  assert.ok(!(await visible(page, '#btn-src')), 'no BGG switch in the preview');
  await page.click('#btn-find');
  await page.waitForSelector('#v-build:not([hidden])');
  assert.match(await page.textContent('#build-eyebrow'), /^Sample shelf · \d+ of 64 games fit 4 players/);
  await page.click('.mode[data-mode="one"]');
  await page.click('#picker [data-n="4"]');
  await page.fill('#host-name', 'Levi');
  await page.click('#btn-create');
  await page.waitForSelector('#v-room:not([hidden])');
  assert.match(await page.textContent('#vote-main'), /Pass it around/);
  await page.click('#t-invite');
  assert.ok(await visible(page, '#inv-local'));
  assert.ok(!(await visible(page, '#inv-online-qr')));
  await page.fill('#proxy-name', 'Beth'); await page.click('#proxy-form button[type=submit]');
  await page.waitForFunction(() => document.querySelector('#tab-n').textContent === '2');
  await page.click('#t-vote');
  await page.click('[data-act="start"]');
  const voters = [];
  for (let guard = 0; guard < 12; guard++) {
    if (/Game on/.test(await page.textContent('#room-title'))) break;
    await page.waitForSelector('#lock-btn', {state: 'visible', timeout: 4000}).catch(() => {});
    if (!(await page.locator('#lock-btn').isVisible())) continue;
    voters.push(await page.textContent('.as-c.on'));
    await pickAll(page);
    await page.waitForTimeout(250);
  }
  assert.ok(voters.some(v => /Levi/.test(v)) && voters.some(v => /Beth/.test(v)), 'both people voted on the one phone: ' + voters.join(' / '));
  await waitTitle(page, /Game on/);
  await ctx.close();
});

/* ============ 5. no helper configured yet ============ */
await t('live page before the BGG helper exists: sample shelf only, with a note', async () => {
  const {ctx, page} = await phone({cfg: {ntfy: 'https://ntfy.test'}});
  await page.goto(BASE);
  assert.ok(await visible(page, '#shelf-sample'));
  assert.match(await page.textContent('#shelf-note'), /switches on once the BGG connection is set up/);
  assert.ok(!(await visible(page, '#preview-banner')));
  await ctx.close();
});

/* ============ 6. look: narrow phone + dark mode ============ */
if (SHOTS) await t('screenshots: 360px wide and dark mode', async () => {
  const {ctx, page} = await phone({viewport: {width: 360, height: 740}, colorScheme: 'dark'});
  await page.goto(BASE);
  await shot(page, '12-setup-dark-360', true);
  await page.fill('#bgg-user', 'levitest'); await page.click('#btn-find');
  await page.waitForSelector('#v-build:not([hidden])', {timeout: 40000});
  await shot(page, '13-build-dark-360', true);
  await page.fill('#host-name', 'Levi'); await page.click('#btn-create');
  await page.waitForSelector('#v-room:not([hidden])');
  const chip = await page.locator('#codechip').boundingBox(), brand = await page.locator('.brand').boundingBox();
  assert.ok(brand.x + brand.width <= chip.x, 'brand and code chip fit side by side at 360px');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no sideways scrolling');
  await shot(page, '14-lobby-dark-360', false);
  await ctx.close();
});

await browser.close(); server.close();
if (errors.length) { console.log('\nPage errors:\n' + errors.join('\n')); process.exitCode = 1; }
console.log(`\n${passed} browser tests passed` + (errors.length ? ', but with page errors' : ''));
