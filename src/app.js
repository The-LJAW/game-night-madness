'use strict';
(function () {

/* =========================================================
   SETTINGS: the lines to edit when going live
   ========================================================= */
const CFG = Object.assign({
  /* Address of the BGG helper (the Cloudflare Worker in bgg-helper/worker.js), e.g.
     'https://gnm-bgg.your-name.workers.dev'. While it's empty, the app offers the sample shelf only. */
  bggProxy: '',
  /* PostHog public project key (starts with phc_). Empty turns usage analytics off. */
  posthogKey: '',
  /* Message relay for live voting between phones. */
  ntfy: 'https://ntfy.sh'
}, window.GNM_CONFIG || {});
const PREVIEW = !!window.GNM_PREVIEW;

/* ---------- small helpers ---------- */
const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));
/* localStorage when the browser allows it, otherwise memory for this visit (private windows, previews) */
const LS_OK = (() => { try { localStorage.setItem('gn.t', '1'); localStorage.removeItem('gn.t'); return true; } catch (e) { return false; } })();
const MEM = {};
const store = {
  get(k, d) {
    if (!LS_OK) return Object.prototype.hasOwnProperty.call(MEM, k) ? MEM[k] : d;
    try { const v = localStorage.getItem('gn.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; }
  },
  set(k, v) {
    if (!LS_OK) { MEM[k] = v; return true; }
    try { localStorage.setItem('gn.' + k, JSON.stringify(v)); return true; } catch (e) { return false; }
  },
  keys() {
    if (!LS_OK) return Object.keys(MEM);
    try { return Object.keys(localStorage).filter(k => k.indexOf('gn.') === 0).map(k => k.slice(3)); } catch (e) { return []; }
  },
  del(k) { delete MEM[k]; if (LS_OK) { try { localStorage.removeItem('gn.' + k); } catch (e) {} } }
};
const ALPH = 'abcdefghjkmnpqrstuvwxyz23456789';
function rid(n) {
  const b = new Uint8Array(n);
  try { crypto.getRandomValues(b); } catch (e) { for (let i = 0; i < n; i++) b[i] = Math.floor(Math.random() * 256); }
  let s = ''; for (let i = 0; i < n; i++) s += ALPH[b[i] % ALPH.length]; return s;
}
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
function toast(msg, ms) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms || 2800);
}
function busy(btn, on, label) {
  if (!btn) return;
  if (on) { btn._html = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spin"></span><span>' + esc(label || 'Working…') + '</span>'; }
  else { btn.disabled = false; if (btn._html != null) btn.innerHTML = btn._html; }
}
let VIEW = '';
function show(v) { VIEW = v; $$('.view').forEach(el => { el.hidden = el.id !== 'v-' + v; }); if (v !== 'room') $('#lockbar').hidden = true; window.scrollTo(0, 0); }
const fmtCode = c => String(c || '').toUpperCase().replace(/^(.{4})(.+)$/, '$1 $2');

let me = store.get('me', null);
if (!me || typeof me.id !== 'string') { me = {id: rid(12), name: ''}; store.set('me', me); }
function setMyName(n) { me.name = n; store.set('me', me); }

/* ---------- anonymous usage analytics (PostHog) ----------
   Only named events are sent (no autocapture, no screen recording, no cookies).
   Never sent: voter names or BGG usernames. */
const PH_KEY = CFG.posthogKey || '';
const PH_HOST = 'https://us.i.posthog.com';
const APP_VERSION = '2026.09.30';
const VIA = (new URLSearchParams(location.search).get('via') || '').toLowerCase().replace(/[^a-z]/g, '').slice(0, 12);
const FIRST_VISIT = !store.get('seen', 0); store.set('seen', 1);
const AN = {q: [], ready: false, dead: PREVIEW || !/^phc_[A-Za-z0-9]+$/.test(PH_KEY)};
function track(event, props) {
  if (AN.dead) return;
  const p = Object.assign({app_version: APP_VERSION}, props || {});
  try { if (AN.ready) window.posthog.capture(event, p); else if (AN.q.length < 200) AN.q.push([event, p]); } catch (e) {}
}
function loadAnalytics() {
  if (AN.dead) return;
  const s = document.createElement('script');
  s.async = true; s.crossOrigin = 'anonymous';
  s.src = PH_HOST.replace('.i.posthog.com', '-assets.i.posthog.com') + '/static/array.js';
  s.onload = () => {
    try {
      window.posthog.init(PH_KEY, {
        api_host: PH_HOST, autocapture: false, capture_pageview: false, capture_pageleave: false,
        disable_session_recording: true, disable_surveys: true, advanced_disable_flags: true,
        persistence: 'localStorage', person_profiles: 'always',
        bootstrap: {distinctID: me.id, isIdentifiedID: true}
      });
      AN.ready = true;
      AN.q.splice(0).forEach(([e, p]) => window.posthog.capture(e, p));
    } catch (e) { AN.dead = true; AN.q.length = 0; }
  };
  s.onerror = () => { AN.dead = true; AN.q.length = 0; };
  document.head.appendChild(s);
}
/* true the first time this device sees a key, so organizer-side events fire once */
function sentOnce(key) {
  const m = store.get('sent', {});
  if (m[key]) return false;
  m[key] = Date.now();
  const ks = Object.keys(m);
  if (ks.length > 300) ks.sort((a, b) => m[a] - m[b]).slice(0, ks.length - 300).forEach(k => { delete m[k]; });
  store.set('sent', m);
  return true;
}

/* ---------- game types ----------
   Built from BoardGameGeek's own data: its game types (the ranked "subdomains"), categories,
   mechanics, and complexity weight. A game can belong to several types. */
const has = (list, re) => !!list && list.some(v => re.test(v));
const HISTORY = /^(Ancient|Medieval|Renaissance|Age of Reason|Napoleonic|Post-Napoleonic|Civilization|American West|American Civil War|American Revolutionary War|American Indian Wars|Civil War|World War I|World War II|Korean War|Vietnam War|Modern Warfare|Pike and Shot|Arabian)$/;
const TYPES = [
  /* how it plays */
  {k: 'party', n: 'Party', lens: 'play', t: g => g.sub.includes('party') || has(g.c, /^Party Game$/)},
  {k: 'coop', n: 'Co-op', lens: 'play', t: g => has(g.m, /^Cooperative Game$/)},
  {k: 'deduction', n: 'Social deduction', lens: 'play', t: g => has(g.m, /^(Hidden Roles|Traitor Game)$/)},
  {k: 'strategy', n: 'Strategy', lens: 'play', t: g => g.sub.includes('strategy')},
  {k: 'heavy', n: 'Brain burners', lens: 'play', t: g => g.w >= 3.5},
  {k: 'family', n: 'Family', lens: 'play', t: g => g.sub.includes('family')},
  {k: 'thematic', n: 'Thematic', lens: 'play', t: g => g.sub.includes('thematic')},
  {k: 'card', n: 'Card games', lens: 'play', t: g => has(g.c, /^Card Game$/)},
  {k: 'dice', n: 'Dice games', lens: 'play', t: g => has(g.c, /^Dice$/)},
  {k: 'deck', n: 'Deck builders', lens: 'play', t: g => has(g.m, /^Deck, Bag,? and Pool Building$|^Deck \/ Pool Building$/)},
  {k: 'workers', n: 'Worker placement', lens: 'play', t: g => has(g.m, /^Worker Placement/)},
  {k: 'area', n: 'Area control', lens: 'play', t: g => has(g.m, /^Area (Majority|Control)/)},
  {k: 'tiles', n: 'Tile laying', lens: 'play', t: g => has(g.m, /^Tile Placement$/)},
  {k: 'draft', n: 'Drafting', lens: 'play', t: g => has(g.m, /Drafting$/)},
  {k: 'trick', n: 'Trick-taking', lens: 'play', t: g => has(g.m, /^Trick-taking$/i)},
  {k: 'luck', n: 'Push your luck', lens: 'play', t: g => has(g.m, /^(Push|Press) Your Luck$/)},
  {k: 'bluff', n: 'Bluffing', lens: 'play', t: g => has(g.c, /^Bluffing$/)},
  {k: 'words', n: 'Word & trivia', lens: 'play', t: g => has(g.c, /^(Word Game|Trivia)$/)},
  {k: 'dexterity', n: 'Dexterity', lens: 'play', t: g => has(g.c, /^Action \/ Dexterity$/) || has(g.m, /^(Flicking|Stacking and Balancing)$/)},
  {k: 'realtime', n: 'Real-time', lens: 'play', t: g => has(g.m, /^Real-Time$/i) || has(g.c, /^Real-time$/i)},
  {k: 'economic', n: 'Economic', lens: 'play', t: g => has(g.c, /^Economic$/)},
  {k: 'negotiation', n: 'Negotiation', lens: 'play', t: g => has(g.c, /^Negotiation$/) || has(g.m, /^(Negotiation|Trading)$/)},
  {k: 'write', n: 'Roll & write', lens: 'play', t: g => has(g.f, /(Roll|Flip)[- ]and[- ]Write/i) || (has(g.m, /^Paper-and-Pencil$/) && (has(g.c, /^Dice$/) || has(g.m, /^(Dice Rolling|Pattern Building)$/)))},
  {k: 'campaign', n: 'Campaign & legacy', lens: 'play', t: g => has(g.m, /^(Legacy Game|Scenario \/ Mission \/ Campaign Game)$/)},
  {k: 'abstract', n: 'Abstract', lens: 'play', t: g => g.sub.includes('abstract') || has(g.c, /^Abstract Strategy$/)},
  {k: 'war', n: 'Wargames', lens: 'play', t: g => g.sub.includes('war') || has(g.c, /^Wargame$/)},
  {k: 'duel', n: 'Two-player duels', lens: 'play', t: g => g.p1 === 2},
  {k: 'filler', n: 'Quick fillers', lens: 'play', t: g => g.t > 0 && g.t <= 30},
  {k: 'kids', n: 'Kids', lens: 'play', t: g => g.sub.includes('kids') || has(g.c, /^Children's Game$/)},
  {k: 'cgs', n: 'Collectible & LCGs', lens: 'play', t: g => g.sub.includes('cgs') || has(g.c, /^Collectible Components$/)},
  /* theme */
  {k: 'fantasy', n: 'Fantasy', lens: 'theme', t: g => has(g.c, /^Fantasy$/)},
  {k: 'scifi', n: 'Sci-fi & space', lens: 'theme', t: g => has(g.c, /^(Science Fiction|Space Exploration)$/)},
  {k: 'horror', n: 'Horror', lens: 'theme', t: g => has(g.c, /^(Horror|Zombies)$/)},
  {k: 'mystery', n: 'Mystery & spies', lens: 'theme', t: g => has(g.c, /^(Murder\/Mystery|Spies\/Secret Agents|Mafia)$/)},
  {k: 'nature', n: 'Animals & nature', lens: 'theme', t: g => has(g.c, /^(Animals|Environmental|Farming|Prehistoric)$/)},
  {k: 'history', n: 'History', lens: 'theme', t: g => has(g.c, HISTORY)},
  {k: 'adventure', n: 'Adventure', lens: 'theme', t: g => has(g.c, /^(Adventure|Exploration)$/)},
  {k: 'myth', n: 'Myth & legend', lens: 'theme', t: g => has(g.c, /^(Mythology|Religious)$/)},
  {k: 'sea', n: 'Pirates & the sea', lens: 'theme', t: g => has(g.c, /^(Nautical|Pirates)$/)},
  {k: 'travel', n: 'Trains & travel', lens: 'theme', t: g => has(g.c, /^(Trains|Transportation|Travel|Aviation \/ Flight)$/)},
  {k: 'build', n: 'Cities & industry', lens: 'theme', t: g => has(g.c, /^(City Building|Industry \/ Manufacturing)$/)},
  {k: 'sports', n: 'Sports & racing', lens: 'theme', t: g => has(g.c, /^(Sports|Racing)$/)},
  {k: 'pop', n: 'Pop culture', lens: 'theme', t: g => has(g.c, /^(Movies \/ TV \/ Radio theme|Video Game Theme|Comic Book \/ Strip|Novel-based|Music)$/)},
  {k: 'humor', n: 'Humor', lens: 'theme', t: g => has(g.c, /^Humor$/)}
];
const WILD = {k: 'wild', n: 'Wildcard', lens: '*'};
const TYPE = {wild: WILD}; TYPES.forEach((t, i) => { t.i = i; TYPE[t.k] = t; });
function typesOf(g) {
  const x = {sub: g.sub || [], c: g.c || [], m: g.m || [], f: g.f || [], w: +g.w || 0, p1: +g.p1 || 0, t: +g.t || 0};
  return TYPES.filter(t => { try { return !!t.t(x); } catch (e) { return false; } }).map(t => t.k);
}
/* games grouped by type for one lens; games that fit no type land in Wildcard */
function byType(list, lens) {
  const m = {};
  list.forEach(g => {
    let ks = (g.ty || []).filter(k => TYPE[k] && TYPE[k].lens === lens);
    if (!ks.length) ks = ['wild'];
    ks.forEach(k => { (m[k] = m[k] || []).push(g); });
  });
  return m;
}
const typeOrder = k => (TYPE[k] && TYPE[k].i != null ? TYPE[k].i : 999);

/* ---------- labels ---------- */
const PLAYERS = [2, 3, 4, 5, 6, 7, 8];
const TIMES = [30, 60, 90, 120, 180, 0];
const nText = n => (n >= 8 ? '8+' : String(n));
const playersText = n => nText(n) + ' players';
function fmtMin(m) { m = +m || 0; if (!m) return ''; if (m < 120) return m + ' min'; return (Math.round(m / 30) / 2) + ' hr'; }
const timeText = tm => tm ? 'up to ' + fmtMin(tm) : 'any length';
const ctxShort = cx => cx ? playersText(cx.n) + ' · ' + timeText(cx.tm) : '';
function weightLabel(w) { w = +w || 0; if (!w) return ''; return w < 1.5 ? 'Light' : w < 2.5 ? 'Medium-light' : w < 3.5 ? 'Medium' : w < 4.5 ? 'Medium-heavy' : 'Heavy'; }
function playersRange(p0, p1) {
  p0 = +p0 || 0; p1 = +p1 || 0;
  if (!p0 && !p1) return '';
  if (!p1 || p0 === p1) return plural(p0 || p1, 'player');
  return (p0 || 1) + '–' + p1 + ' players';
}
function gameSub(e, n) {
  return [playersRange(e.p0, e.p1), fmtMin(e.t), weightLabel(e.w), e.b && n ? 'best at ' + nText(n) : ''].filter(Boolean).join(' · ');
}
const IMG_HOST = 'https://cf.geekdo-images.com/';
function imgPath(u) {
  u = String(u || '').trim();
  if (u.indexOf('//') === 0) u = 'https:' + u;
  return u.indexOf(IMG_HOST) === 0 ? u.slice(IMG_HOST.length) : '';
}
function imgURL(p) {
  p = String(p || '');
  return p && p.length < 400 && p.indexOf('//') === -1 && /^[\w-]+\/[\w\-=\/.:()%,~+@]+$/.test(p) ? IMG_HOST + p : '';
}
function thumbHTML(e, cls) {
  const src = imgURL(e.im);
  const letter = String(e.n || '?').replace(/^(the|a|an)\s+/i, '').replace(/^[^A-Za-z0-9]+/, '').charAt(0).toUpperCase() || '?';
  return '<span class="th' + (cls ? ' ' + cls : '') + '" data-l="' + esc(letter) + '" aria-hidden="true">' + (src ? '<img src="' + esc(src) + '" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">' : '') + '</span>';
}
const bggURL = id => (Number.isInteger(+id) && +id > 0 ? 'https://boardgamegeek.com/boardgame/' + (+id) : 'https://boardgamegeek.com');
const howToURL = name => 'https://www.youtube.com/results?search_query=' + encodeURIComponent('how to play ' + name + ' board game');

/* ---------- BoardGameGeek: collection + game details ---------- */
const SUBDOMAINS = {strategygames: 'strategy', familygames: 'family', partygames: 'party', thematic: 'thematic', abstracts: 'abstract', wargames: 'war', cgs: 'cgs', childrensgames: 'kids'};
const USER_RE = /^[A-Za-z0-9_][A-Za-z0-9_ .\-]{0,39}$/;
function bggErr(code, msg) { const e = new Error(msg || code); e.code = code; return e; }
const num = (s, d) => { const n = parseFloat(s); return isFinite(n) ? n : (d == null ? 0 : d); };
const kids = (el, tag) => (el ? Array.from(el.children).filter(c => c.tagName === tag) : []);
const kid = (el, tag) => kids(el, tag)[0] || null;
const attr = (el, a) => (el ? el.getAttribute(a) : null);
const text = el => (el ? el.textContent.trim() : '');
function xmlDoc(txt) {
  const doc = new DOMParser().parseFromString(String(txt || ''), 'text/xml');
  if (!doc.documentElement || doc.getElementsByTagName('parsererror').length) throw bggErr('parse', 'BoardGameGeek sent something we couldn’t read.');
  return doc;
}
function bggErrors(doc) {
  const root = doc.documentElement;
  if (root.tagName === 'errors' || root.tagName === 'error') return Array.from(root.getElementsByTagName('message')).map(text).join(' ') || text(root) || 'error';
  return '';
}
function subsFrom(ranks) {
  return kids(ranks, 'rank').filter(r => attr(r, 'type') === 'family').map(r => SUBDOMAINS[attr(r, 'name')]).filter(Boolean);
}
function parseCollection(txt) {
  const doc = xmlDoc(txt), err = bggErrors(doc);
  if (err) throw bggErr(/invalid username|user not found|not found/i.test(err) ? 'nouser' : 'bgg', err);
  const root = doc.documentElement;
  if (root.tagName === 'message') throw bggErr('queued', text(root));
  if (root.tagName !== 'items') throw bggErr('parse', 'Unexpected reply from BoardGameGeek.');
  const out = [], seen = new Set();
  kids(root, 'item').forEach(it => {
    const sub = attr(it, 'subtype');
    if (sub && sub !== 'boardgame') return;
    const id = parseInt(attr(it, 'objectid'), 10);
    if (!id || seen.has(id)) return;
    const status = kid(it, 'status');
    if (status && attr(status, 'own') !== '1') return;
    seen.add(id);
    const st = kid(it, 'stats'), rt = kid(st, 'rating');
    out.push({
      id, n: text(kid(it, 'name')) || 'Game ' + id, y: num(text(kid(it, 'yearpublished'))),
      im: imgPath(text(kid(it, 'thumbnail'))),
      p0: num(attr(st, 'minplayers')), p1: num(attr(st, 'maxplayers')),
      t: num(attr(st, 'playingtime')) || num(attr(st, 'maxplaytime')) || num(attr(st, 'minplaytime')),
      ur: num(attr(rt, 'value')), ba: Math.round(num(attr(kid(rt, 'average'), 'value')) * 100) / 100,
      pl: num(text(kid(it, 'numplays'))), sub: subsFrom(kid(rt, 'ranks'))
    });
  });
  return out;
}
function pollFrom(p) {
  if (!p) return null;
  const out = {};
  kids(p, 'results').forEach(r => {
    const k = attr(r, 'numplayers');
    if (!k || !/^\d+$/.test(k)) return;
    const v = {};
    kids(r, 'result').forEach(x => { v[attr(x, 'value')] = num(attr(x, 'numvotes')); });
    out[k] = [v['Best'] || 0, v['Recommended'] || 0, v['Not Recommended'] || 0];
  });
  return Object.keys(out).length ? out : null;
}
function parseThings(txt) {
  const doc = xmlDoc(txt), err = bggErrors(doc);
  if (err) throw bggErr('bgg', err);
  const map = {};
  kids(doc.documentElement, 'item').forEach(it => {
    const id = parseInt(attr(it, 'id'), 10);
    if (!id) return;
    const links = kids(it, 'link');
    const vals = type => links.filter(l => attr(l, 'type') === type).map(l => attr(l, 'value')).filter(Boolean);
    const rts = kid(kid(it, 'statistics'), 'ratings');
    map[id] = {
      at: Date.now(), c: vals('boardgamecategory'), m: vals('boardgamemechanic'),
      f: vals('boardgamefamily').filter(v => /^Mechanism: /.test(v)),
      w: Math.round(num(attr(kid(rts, 'averageweight'), 'value')) * 100) / 100,
      sub: subsFrom(kid(rts, 'ranks')),
      np: pollFrom(kids(it, 'poll').find(p => attr(p, 'name') === 'suggested_numplayers')),
      p0: num(attr(kid(it, 'minplayers'), 'value')), p1: num(attr(kid(it, 'maxplayers'), 'value')),
      t: num(attr(kid(it, 'playingtime'), 'value'))
    };
  });
  return map;
}
/* BGG's player-count poll: "weak" when most voters say Not Recommended, "best" when Best leads */
function verdict(g, n) {
  const v = g.np && g.np[String(n)];
  if (!v) return '';
  const b = v[0], r = v[1], nr = v[2];
  if (b + r + nr < 5) return '';
  if (nr > b + r) return 'weak';
  if (b >= r && b >= nr) return 'best';
  return 'ok';
}
async function proxyGet(path, onStep) {
  if (!CFG.bggProxy) throw bggErr('setup', 'The BoardGameGeek connection isn’t set up yet.');
  const url = CFG.bggProxy.replace(/\/+$/, '') + path;
  let queued = 0, busyN = 0, netN = 0;
  for (;;) {
    const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 30000);
    let res;
    try { res = await fetch(url, {signal: ctl.signal, cache: 'no-store'}); }
    catch (e) {
      clearTimeout(to);
      if (++netN > 2) throw bggErr('network', 'Couldn’t reach BoardGameGeek.');
      await sleep(1500 * netN); continue;
    }
    clearTimeout(to);
    if (res.status === 200) {
      const body = await res.text();
      if (/^\s*(<\?xml[^>]*>\s*)?<message\b/i.test(body)) { res = {status: 202}; }
      else return body;
    }
    if (res.status === 202) {
      if (++queued > 9) throw bggErr('queued', 'BoardGameGeek is still gathering this collection.');
      if (onStep) onStep('queued', queued);
      await sleep(Math.min(1500 + queued * 1200, 7000)); continue;
    }
    if (res.status === 503 && res.headers && res.headers.get('X-GNM-Error') === 'no-token') throw bggErr('setup', 'The BGG helper has no token yet.');
    if (res.status === 429 || res.status >= 500) {
      if (++busyN > 3) throw bggErr('busy', 'BoardGameGeek is busy.');
      if (onStep) onStep('busy', busyN);
      const ra = parseInt(res.headers && res.headers.get('Retry-After'), 10);
      await sleep(ra > 0 && ra <= 30 ? ra * 1000 : 2500 * busyN); continue;
    }
    if (res.status === 401 || res.status === 403) throw bggErr('auth', 'BoardGameGeek turned the request down (' + res.status + ').');
    if (res.status === 404) throw bggErr('nouser', 'Not found');
    throw bggErr('http', 'HTTP ' + res.status);
  }
}
async function loadCollection(user, onStep, force) {
  const key = 'col.' + user.toLowerCase();
  const cached = store.get(key, null);
  if (!force && cached && Date.now() - cached.at < 3600e3) return {games: cached.games, cached: true, at: cached.at};
  try {
    const games = parseCollection(await proxyGet('/collection?username=' + encodeURIComponent(user), onStep));
    store.set(key, {at: Date.now(), games});
    return {games, cached: false, at: Date.now()};
  } catch (e) {
    if (cached && cached.games && e.code !== 'nouser') return {games: cached.games, cached: true, stale: true, at: cached.at};
    throw e;
  }
}
const DETAIL_TTL = 30 * 864e5;
async function loadDetails(games, onStep) {
  const cache = store.get('gd', {});
  const now = Date.now();
  const need = games.filter(g => !cache[g.id] || now - (cache[g.id].at || 0) > DETAIL_TTL).map(g => g.id).sort((a, b) => a - b);
  let done = games.length - need.length, failed = 0;
  if (need.length && onStep) onStep('details', done, games.length);
  for (let i = 0; i < need.length; i += 20) {
    const ids = need.slice(i, i + 20);
    if (i) await sleep(1100);
    try {
      const map = parseThings(await proxyGet('/thing?id=' + ids.join(','), onStep));
      ids.forEach(id => { cache[id] = map[id] || {at: Date.now(), x: 1}; });
    } catch (e) {
      if (e.code === 'setup' || e.code === 'auth') throw e;
      failed += ids.length;
    }
    done += ids.length;
    if (onStep) onStep('details', done, games.length);
    const ks = Object.keys(cache);
    if (ks.length > 1500) ks.sort((a, b) => (cache[a].at || 0) - (cache[b].at || 0)).slice(0, ks.length - 1500).forEach(k => { delete cache[k]; });
    store.set('gd', cache);
  }
  games.forEach(g => {
    const d = cache[g.id];
    if (!d || d.x) return;
    g.c = d.c; g.m = d.m; g.f = d.f; g.w = d.w; g.np = d.np;
    g.sub = Array.from(new Set((g.sub || []).concat(d.sub || [])));
    if (!g.p0 && d.p0) g.p0 = d.p0;
    if (!g.p1 && d.p1) g.p1 = d.p1;
    if (!g.t && d.t) g.t = d.t;
    g.det = 1;
  });
  return {failed};
}
function fitsBasic(g, q) {
  if (g.p0 && g.p0 > q.n) return false;
  if (g.p1 && g.p1 < q.n) return false;
  if (q.tm && g.t && g.t > q.tm) return false;
  if (q.sh && g.pl > 0) return false;
  return true;
}
function fitsMore(g, q) {
  if (q.hv && g.w >= 3.5) return false;
  if (q.wk && verdict(g, q.n) === 'weak') return false;
  return true;
}
/* The shelf for one set of filters: q = {u, sample, n, tm, wk, hv, sh} */
async function loadShelf(q, onStep) {
  let games, meta = {};
  if (q.sample) { games = sampleShelf(); meta.sample = true; }
  else { const c = await loadCollection(q.u, onStep, q.force); games = c.games.map(g => Object.assign({}, g)); meta = c; }
  const owned = games.length;
  const basic = games.filter(g => fitsBasic(g, q));
  if (!q.sample && basic.length) { const r = await loadDetails(basic, onStep); meta.failed = r.failed; }
  const fit = basic.filter(g => fitsMore(g, q));
  return {games: fit.map(g => shelfItem(g, q.n)), owned, meta};
}
/* what the organizer's phone keeps about each game */
function shelfItem(g, n) {
  return {id: g.id, n: g.n, im: g.im || '', p0: g.p0 || 0, p1: g.p1 || 0, t: g.t || 0, w: g.w || 0, ur: g.ur || 0, ba: g.ba || 0, pl: g.pl || 0,
    b: verdict(g, n) === 'best' ? 1 : 0, ty: typesOf(g)};
}
const rateKey = g => (+g.ur || +g.ba || 0);
function byRating(list) { return list.slice().sort((a, b) => (rateKey(b) - rateKey(a)) || ((b.ba || 0) - (a.ba || 0)) || String(a.n).localeCompare(String(b.n))); }
function typeSub(list) {
  const names = byRating(list).slice(0, 2).map(g => g.n).join(', ');
  const s = plural(list.length, 'game') + ' · ' + names;
  return s.length > 64 ? s.slice(0, 62) + '…' : s;
}
function typeItems(games, lens) {
  const g = byType(games, lens), total = games.length;
  return Object.keys(g)
    .filter(k => !(total > 1 && k !== 'wild' && g[k].length === total))
    .map(k => ({key: k, label: TYPE[k].n, count: g[k].length, sub: typeSub(g[k]), wild: k === 'wild' ? 1 : 0}))
    .sort((a, b) => (a.wild - b.wild) || (b.count - a.count) || (typeOrder(a.key) - typeOrder(b.key)));
}

/*@SAMPLE@*/

/* ---------- bracket math ---------- */
function bracketSize(n) { let s = 2; while (s < n) s *= 2; return s; }
function seedOrder(size) { let o = [1]; while (o.length < size) { const m = o.length * 2 + 1; o = o.reduce((acc, s) => acc.concat([s, m - s]), []); } return o; }
const ROUND_NAMES = {1: 'The Final', 2: 'Semifinals', 4: 'Quarterfinals', 8: 'Round of 16'};
const roundName = matches => ROUND_NAMES[matches] || 'Opening round';
function makeRound(slots) { const m = []; for (let i = 0; i < slots.length; i += 2) m.push({a: slots[i], b: slots[i + 1], w: null, va: 0, vb: 0, how: null}); return {matches: m, closed: false}; }
function newStage(def) {
  const n = def.ents.length, size = bracketSize(n), order = seedOrder(size);
  return {def, n, size, R: Math.log2(size), started: !!def.go, done: false, round: 0,
    rounds: [makeRound(order.map(s => (s <= n ? s - 1 : -1)))], votes: {}, champion: null};
}
/* Same answer on every phone: hashed from the bracket's first message id, the round and the matchup. */
function coinSide(salt, r, i) {
  const str = String(salt) + '|' + r + '|' + i; let h = 2166136261;
  for (let k = 0; k < str.length; k++) { h ^= str.charCodeAt(k); h = Math.imul(h, 16777619); }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) % 2 ? 'T' : 'H';
}
function closeRound(st, hostId, how) {
  const rd = st.rounds[st.round], vs = st.votes[st.round] || {};
  rd.closedBy = how || 'auto';
  rd.matches.forEach((m, i) => {
    if (m.a < 0 || m.b < 0) { m.w = m.a >= 0 ? m.a : m.b; m.how = 'bye'; return; }
    let va = 0, vb = 0;
    for (const id in vs) { const p = vs[id][i]; if (p === m.a) va++; else if (p === m.b) vb++; }
    m.va = va; m.vb = vb;
    if (va !== vb) { m.w = va > vb ? m.a : m.b; m.how = 'votes'; return; }
    if (st.def.tb === 'coin') { m.coin = coinSide(st.salt, st.round, i); m.w = m.coin === 'H' ? Math.min(m.a, m.b) : Math.max(m.a, m.b); m.how = 'coin'; return; }
    const hp = vs[hostId] ? vs[hostId][i] : null;
    if (hp === m.a || hp === m.b) { m.w = hp; m.how = 'host'; } else { m.w = Math.min(m.a, m.b); m.how = 'seed'; }
  });
  rd.closed = true; rd.voters = Object.keys(vs).length;
  const winners = rd.matches.map(m => m.w);
  if (winners.length === 1) { st.champion = winners[0]; st.done = true; }
  else { st.rounds.push(makeRound(winners)); st.round++; }
}
function validDef(d) {
  return Number.isInteger(d.s) && d.s >= 1 && d.s <= 3 && typeof d.host === 'string' && (d.kind === 'type' || d.kind === 'game') &&
    Array.isArray(d.ents) && d.ents.length >= 1 && d.ents.length <= 16 && d.ents.every(e => e && typeof e.n === 'string');
}
const PRI = {bracket: 0, join: 1, start: 2, vote: 3, close: 4};
function sortLog(list) {
  return list.sort((x, y) => (x.time - y.time) || ((PRI[x.d.t] != null ? PRI[x.d.t] : 9) - (PRI[y.d.t] != null ? PRI[y.d.t] : 9)) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
}
/* Every device replays the same ordered log, so everyone derives the same bracket. */
function derive(log) {
  const S = {host: null, parts: [], partMap: {}, stages: {}, current: 0};
  const addPart = (id, n, by) => {
    if (typeof id !== 'string' || !id) return;
    const name = String(n || '').trim().slice(0, 24);
    const ex = S.partMap[id];
    if (ex) { if (name) ex.n = name; return; }
    const p = {id, n: name || 'Guest', by: typeof by === 'string' ? by : null};
    S.partMap[id] = p; S.parts.push(p);
  };
  const settle = st => {
    let guard = 0;
    while (st.started && !st.done && guard++ < 6) {
      const rd = st.rounds[st.round], vs = st.votes[st.round] || {};
      const votable = rd.matches.some(m => m.a >= 0 && m.b >= 0);
      if (!votable || (S.parts.length && S.parts.every(p => vs[p.id]))) closeRound(st, S.host, votable ? 'auto' : 'bye'); else break;
    }
  };
  for (const m of log) {
    const d = m.d;
    if (d.t === 'bracket') {
      if (!validDef(d)) continue;
      if (S.host === null) { if (d.s !== 1) continue; S.host = d.host; }
      else if (d.host !== S.host) continue;
      const cur = S.stages[d.s];
      if (cur && cur.started) continue;
      S.stages[d.s] = newStage(d);
      S.stages[d.s].salt = m.id;
      S.stages[d.s].t0 = m.time;
      if (d.s === 1 && S.t0 == null) S.t0 = m.time;
      if (d.s > S.current) S.current = d.s;
    } else if (S.host === null) {
      continue;
    } else if (d.t === 'join') {
      addPart(d.id, d.n, d.by);
    } else if (d.t === 'start') {
      const st = S.stages[d.s]; if (st && d.host === S.host) st.started = true;
    } else if (d.t === 'vote') {
      const st = S.stages[d.s];
      if (!st || !st.started || st.done || typeof d.r !== 'number' || d.r < st.round || !Array.isArray(d.p)) continue;
      addPart(d.id, d.n);
      (st.votes[d.r] = st.votes[d.r] || {})[d.id] = d.p;
    } else if (d.t === 'close') {
      const st = S.stages[d.s];
      if (st && d.host === S.host && st.started && !st.done && d.r === st.round) closeRound(st, S.host, 'organizer');
    }
    for (const k in S.stages) { const st = S.stages[k]; settle(st); if (st.done && st.doneAt == null) st.doneAt = m.time; }
  }
  return S;
}

/* ---------- sync channels ---------- */
class NtfyChannel {
  constructor(code) { this.code = code; this.url = CFG.ntfy.replace(/\/+$/, '') + '/gamenightmadness-' + code; this.msgs = new Map(); this.loaded = false; this.status = 'connecting'; this.onChange = null; this.onStatus = null; this.onFail = null; }
  ingest(m) {
    if (!m || m.event !== 'message' || typeof m.id !== 'string' || this.msgs.has(m.id)) return false;
    let d; try { d = JSON.parse(m.message); } catch (e) { return false; }
    if (!d || typeof d !== 'object' || typeof d.t !== 'string') return false;
    this.msgs.set(m.id, {id: m.id, time: +m.time || 0, d}); return true;
  }
  log() { return sortLog(Array.from(this.msgs.values())); }
  changed() { if (!this.onChange) return; clearTimeout(this._t); this._t = setTimeout(() => this.onChange && this.onChange(this.log()), 40); }
  setStatus(s) { if (this.status !== s) { this.status = s; if (this.onStatus) this.onStatus(s); } }
  async poll() {
    try {
      const r = await fetch(this.url + '/json?poll=1&since=all', {cache: 'no-store'});
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const txt = await r.text(); let ch = false;
      txt.split('\n').forEach(line => { if (!line.trim()) return; try { if (this.ingest(JSON.parse(line))) ch = true; } catch (e) {} });
      const first = !this.loaded; this.loaded = true; this.pollOk = Date.now();
      this.setStatus('live');
      if (ch || first) this.changed();
      return true;
    } catch (e) {
      if (!this.esOpen) this.setStatus('offline');
      if (!this.loaded && this.onFail) this.onFail(e);
      return false;
    }
  }
  connect() {
    if (this._on) return; this._on = true;
    this.poll();
    if ('EventSource' in window) {
      try {
        const es = new EventSource(this.url + '/sse?since=all'); this.es = es;
        es.onopen = () => { this.esOpen = true; this.setStatus('live'); clearTimeout(this._pt); this._pt = setTimeout(() => this.poll(), 2500); };
        es.onmessage = e => { try { if (this.ingest(JSON.parse(e.data))) this.changed(); } catch (x) {} };
        es.onerror = () => { this.esOpen = false; if (!this.pollOk || Date.now() - this.pollOk > 30000) this.setStatus('reconnecting'); };
      } catch (e) {}
    }
    this._iv = setInterval(() => this.poll(), this.es ? 20000 : 6000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.poll(); });
  }
  async publish(d) {
    const r = await fetch(this.url, {method: 'POST', body: JSON.stringify(d)});
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const m = await r.json(); if (this.ingest(m)) this.changed(); return m;
  }
}
/* One phone passed around: the log lives on this device (in memory if storage is off). */
class LocalChannel {
  constructor(code) { this.code = code; this.key = 'log.' + code; this.loaded = true; this.local = true; this.status = 'local'; this.onChange = null; this.list = store.get(this.key, []); }
  log() { return sortLog(this.list.map(m => ({id: m.id, time: m.time, d: m.d}))); }
  changed() { if (this.onChange) setTimeout(() => this.onChange && this.onChange(this.log()), 0); }
  connect() {
    this.changed();
    window.addEventListener('storage', e => { if (e.key === 'gn.' + this.key) { try { this.list = JSON.parse(e.newValue) || []; } catch (x) {} this.changed(); } });
    if (this.onStatus) this.onStatus('local');
  }
  poll() { this.changed(); return Promise.resolve(true); }
  async publish(d) {
    const m = {id: rid(12), time: Math.floor(Date.now() / 1000), d};
    this.list.push(m); store.set(this.key, this.list); this.changed(); return m;
  }
}
async function sendVia(chan, d) {
  let err;
  for (let i = 0; i < 3; i++) { try { return await chan.publish(d); } catch (e) { err = e; await sleep(700 * (i + 1)); } }
  track('error', {where: 'voting_server_send', message_type: d && d.t, detail: String(err && err.message || err).slice(0, 80)});
  throw err;
}

/* ---------- QR ---------- */
function qrSVG(text) {
  const q = qrcode(0, 'M'); q.addData(text); q.make();
  const n = q.getModuleCount(), m = 2, s = n + m * 2; let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += 'M' + (c + m) + ' ' + (r + m) + 'h1v1h-1z';
  return '<svg viewBox="0 0 ' + s + ' ' + s + '" shape-rendering="crispEdges" role="img" aria-label="QR code that opens this bracket"><rect width="' + s + '" height="' + s + '" fill="#fff"/><path d="' + d + '" fill="#111"/></svg>';
}

/* ---------- bracket drawing ---------- */
function bracketHTML(st, o) {
  o = Object.assign({cw: 164, gx: 26, mh: 58, pitch: 70, labels: true}, o || {});
  const size = st.size, R = st.R, E = st.def.ents;
  const LH = o.labels ? 30 : 0, H = (size / 2) * o.pitch, W = (R + 1) * o.cw + R * o.gx;
  let boxes = '', lines = '', labels = '';
  const row = (e, votes, cls, coin) => {
    if (e == null) return '<div class="bk-e tbd"><span class="sd"></span><span class="nm">TBD</span></div>';
    if (e < 0) return '<div class="bk-e bye"><span class="sd"></span><span class="nm">bye</span></div>';
    return '<div class="bk-e' + cls + '" title="' + esc(E[e].n) + '"><span class="sd">' + (e + 1) + '</span><span class="nm">' + esc(E[e].n) + '</span>' + (coin ? '<span class="coin-img mini-coin ' + (coin === 'T' ? 't' : 'h') + '" title="Won the coin flip"></span>' : '') + (votes != null ? '<span class="vt">' + votes + '</span>' : '') + '</div>';
  };
  for (let r = 0; r <= R; r++) {
    const x = r * (o.cw + o.gx);
    if (o.labels) labels += '<div class="bk-rl" style="left:' + x + 'px">' + (r < R ? roundName(size / Math.pow(2, r + 1)) : 'Champion') + '</div>';
    if (r === R) break;
    const k = size / Math.pow(2, r + 1), rd = st.rounds[r];
    for (let m = 0; m < k; m++) {
      const yc = LH + (m + 0.5) * H / k;
      const mt = rd ? rd.matches[m] : null;
      const a = mt ? mt.a : null, b = mt ? mt.b : null;
      const done = !!(mt && mt.w != null), sv = done && mt.how !== 'bye';
      const live = st.started && !st.done && r === st.round;
      boxes += '<div class="bk-m' + (live ? ' live' : '') + '" style="left:' + x + 'px;top:' + (yc - o.mh / 2) + 'px;width:' + o.cw + 'px;height:' + o.mh + 'px">' +
        row(a, sv ? mt.va : null, done ? (mt.w === a ? ' w' : ' l') : '', done && mt.how === 'coin' && mt.w === a ? mt.coin : null) + row(b, sv ? mt.vb : null, done ? (mt.w === b ? ' w' : ' l') : '', done && mt.how === 'coin' && mt.w === b ? mt.coin : null) + '</div>';
      const xn = x + o.cw;
      const yn = r < R - 1 ? LH + (Math.floor(m / 2) + 0.5) * H / (k / 2) : yc;
      lines += '<path class="' + (done ? 'hot' : '') + '" d="M' + xn + ' ' + yc + 'H' + (xn + o.gx / 2) + 'V' + yn + 'H' + (xn + o.gx) + '"/>';
    }
  }
  const xc = R * (o.cw + o.gx), yc = LH + H / 2, ch = Math.round(o.mh * 0.62);
  const c = st.done ? st.champion : null;
  boxes += '<div class="bk-m champ-box" style="left:' + xc + 'px;top:' + (yc - ch / 2) + 'px;width:' + o.cw + 'px;height:' + ch + 'px">' +
    (c != null ? '<div class="bk-e w" title="' + esc(E[c].n) + '"><span class="sd">' + (c + 1) + '</span><span class="nm">' + esc(E[c].n) + '</span></div>' : '<div class="bk-e tbd"><span class="sd">?</span><span class="nm">TBD</span></div>') + '</div>';
  return '<div class="bk-scroll"><div class="bk" style="width:' + W + 'px;height:' + (LH + H) + 'px"><svg class="bk-lines" width="' + W + '" height="' + (LH + H) + '" viewBox="0 0 ' + W + ' ' + (LH + H) + '" aria-hidden="true">' + lines + '</svg>' + labels + boxes + '</div></div>';
}

/* ---------- entrant picker ---------- */
function countText(n, min) {
  if (n < min) return min === 1 ? 'Pick at least one.' : 'Pick at least ' + min + ' to make a bracket.';
  if (n === 1) return 'Just one contender, so it wins by default.';
  const size = bracketSize(n), R = Math.log2(size), byes = size - n;
  return plural(n, 'contender') + ' · ' + plural(R, 'round') + (byes ? ' · top ' + (byes === 1 ? 'seed gets' : byes + ' seeds get') + ' a bye' : '');
}
function Picker(root, cfg) {
  const base = cfg.items.slice(), min = cfg.min || 2, games = cfg.kind === 'game';
  let order = base.slice(), sel = new Set(), q = '', shown = 30;
  const sizes = [4, 8, 16].filter(n => n < base.length);
  const allN = base.length <= 16 ? base.length : 0;
  root.innerHTML =
    '<div class="pk-bar">' +
      (sizes.length || allN ? '<div class="seg" role="group" aria-label="How many contenders">' + sizes.map(n => '<button type="button" data-n="' + n + '" aria-pressed="false">' + n + '</button>').join('') + (allN ? '<button type="button" data-n="' + allN + '" aria-pressed="false">All ' + allN + '</button>' : '') + '</div>' : '') +
      (games && base.length > 2 ? '<div class="seg" role="group" aria-label="Seeding"><button type="button" data-o="top" aria-pressed="true">Top rated</button><button type="button" data-o="shuf" aria-pressed="false">Shuffle</button></div>' : '') +
    '</div>' +
    '<p class="pk-count" aria-live="polite"></p>' +
    (games && base.length > 12 ? '<input type="search" class="pk-search" id="' + (cfg.id || 'pk') + '-search" placeholder="Find a game by name" aria-label="Find a game by name" autocomplete="off">' : '') +
    '<ul class="plist"></ul><button type="button" class="linkbtn pk-more" hidden></button>';
  const ul = $('.plist', root), cnt = $('.pk-count', root), more = $('.pk-more', root), search = $('.pk-search', root);
  const ents = () => order.filter(i => sel.has(i.key));
  function fill(n) { sel = new Set(order.slice(0, Math.min(n, 16)).map(i => i.key)); draw(); }
  function draw() {
    const e = ents(), seed = new Map(e.map((i, k) => [i.key, k + 1]));
    const list = q ? order.filter(i => i.label.toLowerCase().indexOf(q) !== -1) : e.concat(order.filter(i => !sel.has(i.key)));
    const vis = list.slice(0, q ? 60 : Math.max(shown, e.length));
    ul.innerHTML = vis.length ? vis.map(i => {
      const on = sel.has(i.key);
      return '<li><label class="pk-row' + (on ? ' on' : '') + '"><input type="checkbox" data-k="' + esc(i.key) + '"' + (on ? ' checked' : '') + '><span class="sd">' + (seed.get(i.key) || '') + '</span>' + (games ? thumbHTML({n: i.label, im: i.im}) : '') + '<span class="pk-txt"><b>' + esc(i.label) + '</b><small>' + esc(i.sub) + '</small></span></label></li>';
    }).join('') : '<li class="pk-empty">Nothing matches “' + esc(q) + '”.</li>';
    const rest = list.length - vis.length;
    more.hidden = rest <= 0; more.textContent = 'Show ' + Math.min(30, rest) + ' more';
    cnt.textContent = countText(e.length, min);
    $$('[data-n]', root).forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.n === e.length)));
    if (cfg.onChange) cfg.onChange(e);
  }
  root.onchange = ev => {
    const cb = ev.target.closest && ev.target.closest('input[type=checkbox][data-k]'); if (!cb) return;
    if (cb.checked) { if (sel.size >= 16) { cb.checked = false; toast('Brackets top out at 16 contenders.'); return; } sel.add(cb.dataset.k); }
    else sel.delete(cb.dataset.k);
    draw();
  };
  root.onclick = ev => {
    const b = ev.target.closest && ev.target.closest('button'); if (!b || !root.contains(b)) return;
    if (b.dataset.n) fill(+b.dataset.n);
    else if (b.dataset.o) {
      const n = sel.size || cfg.initial;
      order = b.dataset.o === 'shuf' ? shuffle(base.slice()) : base.slice();
      $$('[data-o]', root).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      if (cfg.onOrder) cfg.onOrder(b.dataset.o);
      fill(n);
    } else if (b.classList.contains('pk-more')) { shown += 30; draw(); }
  };
  if (search) search.oninput = () => { q = search.value.trim().toLowerCase(); draw(); };
  fill(cfg.initial);
  this.entrants = ents;
}

/* ---------- shared entrant helpers ---------- */
function gameItem(g, n) { return {key: 'g' + g.id, label: g.n, sub: gameSub(g, n), im: g.im, g}; }
function gameEnt(g) {
  const e = {n: g.n, i: g.id, p0: g.p0, p1: g.p1, t: g.t, w: Math.round((+g.w || 0) * 10) / 10};
  if (g.im) e.im = g.im;
  if (g.b) e.b = 1;
  return e;
}
function entSub(def, e) {
  if (def.kind === 'type') return e.x || (e.c ? plural(e.c, 'game') : '');
  return gameSub(e, def.cx && def.cx.n);
}
function defFrom(stage, kind, items, extra) {
  const ents = kind === 'type' ? items.map(i => ({n: i.label, k: i.key, c: i.count, x: i.sub})) : items.map(i => gameEnt(i.g));
  const def = Object.assign({t: 'bracket', v: 1, s: stage, host: me.id, kind, ents}, extra);
  const bytes = () => new Blob([JSON.stringify(def)]).size;
  const strip = keys => def.ents.forEach(e => keys.forEach(k => { delete e[k]; }));
  if (bytes() > 3900) strip(['x']);
  if (bytes() > 3900) strip(['im']);
  if (bytes() > 3900) strip(['b', 'w']);
  if (bytes() > 3900) def.ents.forEach(e => { e.n = e.n.slice(0, 30); });
  if (bytes() > 3900) delete def.q;
  return def;
}

/* ---------- recents ---------- */
function addRecent(code, title) {
  const list = store.get('recent', []).filter(r => r.c !== code);
  list.unshift({c: code, t: title, at: Date.now()}); store.set('recent', list.slice(0, 6));
}
function renderRecent() {
  const list = store.get('recent', []).filter(r => Date.now() - r.at < 12 * 3600e3);
  $('#recent-panel').hidden = !list.length;
  $('#recent-list').innerHTML = list.map(r => {
    const mins = Math.round((Date.now() - r.at) / 60000);
    const ago = mins < 60 ? (mins < 2 ? 'just now' : mins + ' min ago') : Math.round(mins / 60) + ' hr ago';
    return '<li><a href="?b=' + esc(r.c) + '">' + esc(r.t) + ' <small>' + fmtCode(r.c) + ' · ' + ago + '</small></a></li>';
  }).join('');
}
function pruneHostData() {
  store.keys().forEach(k => {
    const age = k.indexOf('host.') === 0 ? 24 * 3600e3 : k.indexOf('col.') === 0 ? 7 * 864e5 : 0;
    if (!age) return;
    const v = store.get(k, null);
    if (!v || Date.now() - (v.at || 0) > age) store.del(k);
  });
}

/* =========================================================
   SETUP (host step 1)
   ========================================================= */
const BGG_READY = !!CFG.bggProxy && !PREVIEW;
const SETUP = Object.assign({src: 'bgg', user: '', n: 4, tm: 90, wk: true, hv: false, sh: false}, store.get('setup', {}));
if (!PLAYERS.includes(SETUP.n)) SETUP.n = 4;
if (!TIMES.includes(SETUP.tm)) SETUP.tm = 90;
if (!BGG_READY) SETUP.src = 'sample';
function saveSetup() { store.set('setup', SETUP); }
function renderSrc() {
  const sample = SETUP.src === 'sample';
  $('#shelf-bgg').hidden = sample; $('#shelf-sample').hidden = !sample;
  $('#sample-sub').textContent = SAMPLE_ROWS.length + ' popular games, for trying the app';
  $('#btn-src').hidden = !BGG_READY;
  $('#btn-src').textContent = sample ? 'Use a BoardGameGeek shelf instead' : 'No BGG account? Try a sample shelf';
  $('#shelf-note').hidden = BGG_READY;
  $('#shelf-note').textContent = PREVIEW ? 'The live version loads your own shelf from BoardGameGeek.' : 'Loading your own BoardGameGeek shelf switches on once the BGG connection is set up.';
  $('#btn-find').textContent = sample ? 'Load the sample shelf' : 'Load the shelf';
}
function initSetup() {
  $('#bgg-user').value = SETUP.user || '';
  $('#bgg-user').oninput = () => { SETUP.user = $('#bgg-user').value.trim(); saveSetup(); };
  $('#bgg-user').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); findGames(); } };
  $('#btn-src').onclick = () => { SETUP.src = SETUP.src === 'sample' ? 'bgg' : 'sample'; saveSetup(); renderSrc(); $('#find-err').hidden = true; if (SETUP.src === 'bgg') $('#bgg-user').focus(); };
  renderSrc();
  $('#players').innerHTML = PLAYERS.map(n => '<button type="button" data-n="' + n + '" aria-pressed="' + (n === SETUP.n) + '" aria-label="' + (n >= 8 ? '8 or more' : n) + ' players"><b>' + nText(n) + '</b></button>').join('');
  $('#players').onclick = e => { const b = e.target.closest('button'); if (!b) return; SETUP.n = +b.dataset.n; saveSetup(); $$('#players button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); };
  const timeNote = () => { $('#time-note').textContent = SETUP.tm ? 'Leaves out games whose listed play time is longer than ' + fmtMin(SETUP.tm) + '.' : 'Every game on the shelf is in, however long it runs.'; };
  $('#times').innerHTML = TIMES.map(m => '<button type="button" data-m="' + m + '" aria-pressed="' + (m === SETUP.tm) + '" aria-label="' + (m ? 'Up to ' + m + ' minutes' : 'Any length') + '"><b>' + (m || 'Any') + '</b><small>' + (m ? 'min' : 'length') + '</small></button>').join('');
  $('#times').onclick = e => { const b = e.target.closest('button'); if (!b) return; SETUP.tm = +b.dataset.m; saveSetup(); timeNote(); $$('#times button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); };
  timeNote();
  [['#f-wk', 'wk'], ['#f-hv', 'hv'], ['#f-sh', 'sh']].forEach(([id, k]) => { $(id).checked = !!SETUP[k]; $(id).onchange = () => { SETUP[k] = $(id).checked; saveSetup(); }; });
  $('#btn-find').onclick = () => findGames();
  $('#code-form').onsubmit = e => {
    e.preventDefault();
    const c = $('#code-in').value.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (c.length < 6) { toast('Codes are 8 letters and numbers, like K7PX 3MQA.'); return; }
    location.href = '?b=' + c;
  };
  const hb = {size: 4, R: 2, started: true, done: false, round: 1, def: {ents: [{n: 'Co-op'}, {n: 'Party'}, {n: 'Dice'}, {n: 'Cards'}]},
    rounds: [{matches: [{a: 0, b: 3, w: 0, va: 4, vb: 1, how: 'votes'}, {a: 1, b: 2, w: 2, va: 2, vb: 3, how: 'votes'}]}, {matches: [{a: 0, b: 2, w: null}]}]};
  SETUP.hero = hb;
}
function drawHero() {
  const el = $('#hero-bracket'), avail = el.clientWidth || 330;
  const cw = Math.max(80, Math.min(128, Math.floor((avail - 20) / 3)));
  el.innerHTML = bracketHTML(SETUP.hero, {cw, gx: 10, mh: 52, pitch: 60, labels: false});
}
function showSetup() { show('setup'); $('#codechip').hidden = true; renderRecent(); drawHero(); }
function findErr(html, act) {
  const box = $('#find-err'); box.hidden = false;
  box.innerHTML = '<p>' + html + '</p>' + (act ? '<div class="row"><button type="button" class="btn ghost sm" data-fe="' + act + '">' + (act === 'sample' ? 'Try the sample shelf' : 'Try again') + '</button></div>' : '');
  const b = $('[data-fe]', box);
  if (b) b.onclick = () => { if (act === 'sample') { SETUP.src = 'sample'; saveSetup(); renderSrc(); } box.hidden = true; findGames(); };
  box.scrollIntoView({behavior: 'smooth', block: 'center'});
}
async function findGames() {
  const btn = $('#btn-find'); if (btn.disabled) return;
  $('#find-err').hidden = true;
  const sample = SETUP.src === 'sample';
  let user = '';
  if (!sample) {
    user = $('#bgg-user').value.trim();
    if (!USER_RE.test(user)) { $('#bgg-user').focus(); toast(user ? 'That doesn’t look like a BGG username.' : 'Type the BGG username whose games we’re using.'); return; }
    SETUP.user = user; saveSetup();
  }
  const q = {u: user, sample: sample ? 1 : 0, n: SETUP.n, tm: SETUP.tm, wk: SETUP.wk ? 1 : 0, hv: SETUP.hv ? 1 : 0, sh: SETUP.sh ? 1 : 0};
  const first = sample ? 'Setting out the sample shelf…' : 'Asking BoardGameGeek for ' + user + '’s games…';
  busy(btn, true, first);
  const line = s => { const el = btn.querySelector('span:last-child'); if (el) el.textContent = s; };
  const t0 = Date.now();
  const onStep = (kind, a, b) => {
    if (kind === 'queued') line(a < 3 ? 'BGG is gathering the collection…' : 'Still gathering. Big shelves take a minute…');
    else if (kind === 'busy') line('BoardGameGeek is busy. Retrying…');
    else if (kind === 'details') line('Reading game details… ' + a + ' of ' + b);
  };
  const secs = () => Math.round((Date.now() - t0) / 100) / 10;
  const props = () => ({source: sample ? 'sample' : 'bgg', players: q.n, minutes: q.tm, weak_filter: !!q.wk, skip_heavy: !!q.hv, shelf_of_shame: !!q.sh, secs: secs()});
  try {
    const r = await loadShelf(q, onStep);
    if (sample) await sleep(350);
    track('shelf_loaded', Object.assign(props(), {owned: r.owned, fit: r.games.length, details_failed: r.meta.failed || 0, from_cache: !!r.meta.cached, stale: !!r.meta.stale}));
    if (!r.owned) { findErr('<b>' + esc(user) + ' has no games marked Owned on BGG.</b> Mark the games you own in your BGG collection, then try again.'); return; }
    if (!r.games.length) { findErr('<b>None of the ' + plural(r.owned, 'owned game') + ' fit ' + playersText(q.n) + ' and ' + timeText(q.tm) + '.</b> Try more time, a different player count, or fewer filters.'); return; }
    BUILD.games = r.games; BUILD.q = q; BUILD.owned = r.owned;
    if (r.meta.stale) toast('BoardGameGeek didn’t answer, so this is the shelf we loaded earlier.', 4000);
    else if (r.meta.failed) toast('BGG didn’t send details for ' + plural(r.meta.failed, 'game') + ', so they may land in Wildcard.', 4000);
    openBuild();
  } catch (e) {
    const code = e && e.code || 'error';
    track('shelf_failed', Object.assign(props(), {reason: code}));
    if (code === 'setup') findErr('<b>The BoardGameGeek connection isn’t switched on yet.</b> Try the sample shelf for now.', 'sample');
    else if (code === 'nouser') findErr('<b>We couldn’t find a BGG user named “' + esc(user) + '”.</b> Check the spelling. It’s the name on your BGG profile, not your email.');
    else if (code === 'queued') findErr('<b>BoardGameGeek is still gathering this collection.</b> Big collections can take a minute. Tap Load the shelf again shortly.', 'retry');
    else if (code === 'auth') findErr('<b>BoardGameGeek turned the request down.</b> The app’s BGG access may be paused. Try the sample shelf for now.', 'sample');
    else findErr('<b>BoardGameGeek isn’t answering right now.</b> Wait a minute and try again.', 'retry');
  } finally { busy(btn, false); }
}

/* =========================================================
   BUILD (host step 2)
   ========================================================= */
const BUILD = {games: [], q: null, owned: 0, mode: store.get('mode', 'two'), lens: store.get('lens', 'play'), cat: '', picker: null};
function openBuild() {
  const games = BUILD.games, q = BUILD.q;
  $('#build-eyebrow').textContent = (q.sample ? 'Sample shelf · ' : '') + games.length + ' of ' + BUILD.owned + ' games fit ' + playersText(q.n) + ', ' + timeText(q.tm);
  const opts = lens => {
    const g = byType(games, lens);
    return TYPES.filter(t => t.lens === lens && g[t.k]).sort((a, b) => g[b.k].length - g[a.k].length)
      .map(t => '<option value="' + lens + ':' + t.k + '">' + esc(t.n) + ' (' + g[t.k].length + ')</option>').join('');
  };
  $('#cat-sel').innerHTML = '<option value="">The whole shelf (' + games.length + ')</option><optgroup label="How it plays">' + opts('play') + '</optgroup><optgroup label="Theme">' + opts('theme') + '</optgroup>';
  $('#cat-sel').value = BUILD.cat;
  if ($('#cat-sel').value !== BUILD.cat) $('#cat-sel').value = '';
  BUILD.cat = $('#cat-sel').value;
  if (typeItems(games, 'play').length < 2 && typeItems(games, 'theme').length < 2) BUILD.mode = 'one';
  else if (typeItems(games, BUILD.lens).length < 2) BUILD.lens = BUILD.lens === 'play' ? 'theme' : 'play';
  $('#host-name').value = me.name || '';
  $('#create-err').hidden = true;
  setMode(BUILD.mode);
  show('build');
}
function setMode(mode) {
  BUILD.mode = mode; store.set('mode', mode);
  $$('.mode').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
  $('#one-cat').hidden = mode !== 'one';
  $('#lens-row').hidden = mode !== 'two';
  $$('#lens button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lens === BUILD.lens)));
  mountBuildPicker();
}
function mountBuildPicker() {
  const root = $('#picker'), q = BUILD.q;
  if (BUILD.mode === 'two') {
    const theme = BUILD.lens === 'theme', word = theme ? 'theme' : 'type';
    const items = typeItems(BUILD.games, BUILD.lens);
    $('#pick-title').textContent = theme ? 'Themes in the running' : 'Game types in the running';
    $('#pick-note').textContent = 'Seeded by how many of your games fit each ' + word + ', so the 1 seed has the most options. A game can count toward more than one ' + word + '.' + (items.some(i => i.wild) ? ' Wildcard is every game that doesn’t fit a ' + word + ' here.' : '');
    BUILD.picker = new Picker(root, {items, kind: 'type', initial: Math.min(8, items.length), id: 'bp'});
  } else {
    const parts = BUILD.cat ? BUILD.cat.split(':') : [];
    const list = byRating(parts.length ? (byType(BUILD.games, parts[0])[parts[1]] || []) : BUILD.games);
    const items = list.map(g => gameItem(g, q.n));
    $('#pick-title').textContent = 'Games in the running';
    const note = o => { $('#pick-note').textContent = o === 'shuf' ? 'Shuffled seeds. Tap Shuffle again for a new draw.' : (q.sample ? 'Seeded by rating, so the best-rated game is the 1 seed.' : 'Seeded by your BGG ratings, or BGG’s average for games you haven’t rated.'); };
    note('top');
    BUILD.picker = new Picker(root, {items, kind: 'game', initial: Math.min(8, items.length), onOrder: note, id: 'bp'});
  }
}
function initBuild() {
  $$('.mode').forEach(b => { b.onclick = () => setMode(b.dataset.mode); });
  $('#lens').onclick = e => { const b = e.target.closest('button[data-lens]'); if (!b) return; BUILD.lens = b.dataset.lens; store.set('lens', BUILD.lens); setMode('two'); };
  $('#cat-sel').onchange = () => { BUILD.cat = $('#cat-sel').value; mountBuildPicker(); };
  $('#btn-back').onclick = () => showSetup();
  $('#btn-create').onclick = () => createBracket(false);
  $('#btn-retry').onclick = () => createBracket(false);
  $('#btn-local').onclick = () => createBracket(true);
}
async function createBracket(localOnly) {
  if (PREVIEW) localOnly = true;
  const items = BUILD.picker ? BUILD.picker.entrants() : [];
  if (items.length < 2) { toast('Pick at least 2 contenders.'); return; }
  const name = $('#host-name').value.trim().slice(0, 24);
  if (!name) { $('#host-name').focus(); toast('Add your name so friends know whose bracket it is.'); return; }
  setMyName(name);
  const code = BUILD.pendingCode || rid(8); BUILD.pendingCode = code;
  const kind = BUILD.mode === 'two' ? 'type' : 'game', q = BUILD.q;
  const parts = BUILD.cat ? BUILD.cat.split(':') : [];
  const title = kind === 'type' ? (BUILD.lens === 'theme' ? 'Theme Showdown' : 'Game Type Showdown') : (parts[1] && TYPE[parts[1]] ? TYPE[parts[1]].n + ' Showdown' : 'Game Showdown');
  const def = defFrom(1, kind, items, {
    mode: BUILD.mode, lens: BUILD.lens, title, tb: 'coin', cx: {n: q.n, tm: q.tm, sample: q.sample},
    q: {u: q.u, sample: q.sample, n: q.n, tm: q.tm, wk: q.wk, hv: q.hv, sh: q.sh}
  });
  pruneHostData();
  store.set('host.' + code, {games: BUILD.games, at: Date.now()});
  const btn = $('#btn-create');
  busy(btn, true, 'Setting up the bracket…'); $('#create-err').hidden = true;
  let chan;
  try {
    if (localOnly) { store.set('localmode.' + code, 1); chan = new LocalChannel(code); }
    else chan = new NtfyChannel(code);
    await sendVia(chan, def);
    await sendVia(chan, {t: 'join', id: me.id, n: name});
  } catch (e) {
    busy(btn, false);
    track('error', {where: 'create_bracket', local_only: !!localOnly, detail: String(e && e.message || e).slice(0, 80)});
    if (!localOnly) { $('#create-err').hidden = false; $('#create-err').scrollIntoView({behavior: 'smooth', block: 'center'}); }
    else toast('This browser won’t let the page save anything. Try a regular (non-private) window.');
    return;
  }
  busy(btn, false); BUILD.pendingCode = null;
  addRecent(code, title);
  track('bracket_created', {code, mode: BUILD.mode, lens: BUILD.mode === 'two' ? BUILD.lens : null, contenders: items.length, rounds: Math.log2(bracketSize(items.length)), players: q.n, minutes: q.tm, type: parts[1] ? TYPE[parts[1]].n : null, local_only: !!localOnly, source: q.sample ? 'sample' : 'bgg', games_fit: BUILD.games.length, games_owned: BUILD.owned});
  try { history.pushState(null, '', '?b=' + code); } catch (e) {}
  openRoom(code, chan);
}

/* =========================================================
   ROOM (everyone)
   ========================================================= */
const R = {code: null, chan: null, S: null, tab: 'vote', picks: {}, editing: {}, acting: null, confirm: null, lastSig: null, voteSig: null, s2: null, qr: null, resOpen: {}, fired: {}};
function shareUrl(via) { return location.origin + location.pathname + '?b=' + R.code + (via ? '&via=' + via : ''); }
function openRoom(code, chan) {
  R.code = code; R.acting = me.id;
  R.chan = chan || (PREVIEW || store.get('localmode.' + code, 0) ? new LocalChannel(code) : new NtfyChannel(code));
  R.chan.onChange = onLog;
  R.chan.onStatus = renderStatus;
  R.chan.onFail = () => { if (sentOnce(code + '.connfail.' + Math.floor(Date.now() / 600000))) track('error', {where: 'voting_server_connect', code}); if (VIEW === 'loading') $('#loading-msg').textContent = 'Can’t reach the voting server yet. Check your connection; we’ll keep trying.'; };
  $('#codechip').hidden = false; $('#codechip').textContent = fmtCode(code);
  if (!R.S) { show('loading'); $('#loading-msg').textContent = 'Loading the bracket…'; }
  R.chan.connect();
  if (R.chan.msgs && R.chan.msgs.size) R.chan.changed();
}
function localVoters(S) {
  const prox = store.get('proxies.' + R.code, []).filter(p => S.partMap[p.id]);
  return [S.partMap[me.id]].concat(prox.map(p => S.partMap[p.id])).filter(Boolean);
}
function onLog(log) {
  const S = derive(log); R.S = S;
  if (!S.host) {
    if (R.chan.loaded && !R._miss) R._miss = setTimeout(async () => { await R.chan.poll(); await sleep(150); if (!R.S || !R.S.host) { show('missing'); track('bracket_missing', {code: R.code, via: VIA || 'direct'}); } }, 3500);
    return;
  }
  clearTimeout(R._miss); R._miss = null;
  if (!S.partMap[me.id]) { if (VIEW !== 'join') openJoin(); else renderJoin(); return; }
  if (VIEW !== 'room') { show('room'); setTab(R.tab); addRecent(R.code, S.stages[1].def.title); }
  announce(S);
  trackProgress(S);
  queueFlips(S);
  renderRoom();
}
/* Only the organizer's phone reports round and bracket results, so each is counted once. */
function trackProgress(S) {
  if (S.host !== me.id) return;
  try {
    Object.keys(S.stages).forEach(k => {
      const s = +k, st = S.stages[k], def = st.def;
      st.rounds.forEach((rd, r) => {
        if (!rd.closed || rd.closedBy === 'bye' || !sentOnce(R.code + '.r.' + s + '.' + r)) return;
        const real = rd.matches.filter(m => m.how !== 'bye');
        track('round_closed', {code: R.code, stage: s, kind: def.kind, round: r, round_name: roundName(rd.matches.length), closed_by: rd.closedBy, voters: rd.voters, total_players: S.parts.length, matchups: real.length, ties: real.filter(m => m.how === 'host' || m.how === 'seed' || m.how === 'coin').length, coin_flips: real.filter(m => m.how === 'coin').length});
      });
      if (!st.done || !sentOnce(R.code + '.done.' + s)) return;
      const E = def.ents, c = E[st.champion], fm = st.rounds[st.rounds.length - 1].matches[0];
      const ru = fm && fm.how !== 'bye' ? E[fm.w === fm.a ? fm.b : fm.a] : null;
      const minutes = st.doneAt != null && S.t0 != null ? Math.round((st.doneAt - S.t0) / 6) / 10 : null;
      const base = {code: R.code, mode: def.mode, lens: def.lens || null, contenders: st.n, players: S.parts.length, no_phone_voters: S.parts.filter(p => p.by).length, minutes_since_created: minutes, player_count: def.cx && def.cx.n, time_limit: def.cx && def.cx.tm, source: def.cx && def.cx.sample ? 'sample' : 'bgg'};
      if (def.kind === 'type') track('type_decided', Object.assign(base, {type: c.n, runner_up: ru ? ru.n : null}));
      else track('bracket_finished', Object.assign(base, {stages: s, winner: c.n, winner_bgg_id: c.i || null, winner_weight: c.w || null, runner_up: ru ? ru.n : null, final_score: fm && fm.how !== 'bye' ? Math.max(fm.va, fm.vb) + '-' + Math.min(fm.va, fm.vb) : null, final_decided_by: fm ? fm.how : null}));
    });
  } catch (e) {}
}
function renderStatus(s) {
  const el = $('#room-status'); el.dataset.s = s;
  $('span', el).textContent = {live: 'Live', connecting: 'Connecting…', reconnecting: 'Reconnecting…', offline: 'Offline, retrying', local: 'This phone only'}[s] || s;
}

/* join */
function openJoin() { show('join'); renderJoin(); $('#join-name').value = me.name || ''; track('join_viewed', {code: R.code, via: VIA || 'direct', first_visit: FIRST_VISIT, already_joined_count: R.S.parts.length, stage: R.S.current, started: !!R.S.stages[R.S.current].started}); }
function shelfOwner(def, host) { return def.cx && def.cx.sample ? 'a sample shelf' : (host ? host.n + '’s shelf' : 'the organizer’s shelf'); }
function renderJoin() {
  const S = R.S, def = S.stages[1].def, host = S.partMap[S.host];
  $('#join-host').textContent = (host ? host.n : 'A friend') + ' wants help picking a game';
  $('#join-title').textContent = def.title;
  $('#join-where').textContent = (def.cx ? 'Games from ' + shelfOwner(def, host) + ' for ' + playersText(def.cx.n) + ', ' + timeText(def.cx.tm) + '. ' : '') + 'Vote on each matchup; the winner of every round moves on' + (def.tb === 'coin' ? ', and ties get a coin flip.' : '.');
  $('#join-ents').innerHTML = fieldHTML(def);
  $('#join-count').textContent = plural(S.parts.length, 'person has', 'people have') + ' joined so far.';
}
function fieldHTML(def) {
  return def.ents.map((e, i) => '<li><span class="sd">' + (i + 1) + '</span>' + (def.kind === 'game' ? thumbHTML(e) : '') + '<span><b>' + esc(e.n) + '</b><small>' + esc(entSub(def, e)) + '</small></span></li>').join('');
}
function initJoin() {
  $('#join-form').onsubmit = async e => {
    e.preventDefault();
    const n = $('#join-name').value.trim().slice(0, 24);
    if (!n) { $('#join-name').focus(); toast('Add your name so everyone knows who voted.'); return; }
    setMyName(n);
    const btn = $('#btn-join'); busy(btn, true, 'Joining…');
    try { await sendVia(R.chan, {t: 'join', id: me.id, n}); track('guest_joined', {code: R.code, via: VIA || 'direct', first_visit: FIRST_VISIT}); }
    catch (err) { toast('Couldn’t join. Check your connection and try again.'); }
    finally { busy(btn, false); }
  };
}

/* header + tabs */
function setTab(t) {
  R.tab = t;
  $$('.tab').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
  $('#p-vote').hidden = t !== 'vote'; $('#p-bracket').hidden = t !== 'bracket'; $('#p-invite').hidden = t !== 'invite';
  if (t === 'bracket') renderBracket();
  updateLockbar();
}
function stageLabel(S) {
  const st = S.stages[S.current];
  if (st.def.mode === 'two') return S.current === 1 ? 'Stage 1 of 2 · Pick the ' + (st.def.lens === 'theme' ? 'theme' : 'game type') : 'Stage 2 of 2 · Pick the game';
  return st.def.title;
}
function renderRoom() {
  const S = R.S, st = S.stages[S.current], isHost = S.host === me.id;
  const host = S.partMap[S.host];
  $('#room-eyebrow').textContent = stageLabel(S);
  $('#room-title').textContent = !st.started ? 'The lobby' : st.done ? (st.def.kind === 'type' ? st.def.ents[st.champion].n + ' wins' : 'Game on') : roundName(st.rounds[st.round].matches.length);
  $('#room-meta').textContent = (host ? host.n + '’s bracket' : 'Bracket') + (st.def.cx ? ' · ' + ctxShort(st.def.cx) : '');
  $('#tab-n').textContent = S.parts.length;
  renderStatus(R.chan.status);
  renderVote(S, st, isHost);
  if (R.tab === 'bracket') renderBracket();
  renderInvite(S);
}
function announce(S) {
  const st = S.stages[S.current];
  const sig = S.current + '.' + (st.started ? 1 : 0) + '.' + st.round + '.' + (st.done ? 1 : 0);
  const prev = R.lastSig; R.lastSig = sig;
  if (!prev || prev === sig) return;
  const E = st.def.ents;
  if (st.done) toast(st.def.kind === 'type' ? E[st.champion].n + ' takes the crown' : E[st.champion].n + ' wins it all');
  else if (st.started && prev.split('.')[0] === String(S.current) && st.round > 0) toast(roundName(st.rounds[st.round - 1].matches.length) + ' is final. On to the ' + roundName(st.rounds[st.round].matches.length) + '.');
  else if (st.started) toast(S.current > 1 ? 'Stage 2 is live. Time to pick the game.' : 'Voting is open!');
  if (R.tab !== 'vote') setTab('vote');
  window.scrollTo({top: 0, behavior: 'smooth'});
}

/* vote tab */
const pkey = (s, r, id) => s + '.' + r + '.' + id;
function renderVote(S, st, isHost) {
  const local = localVoters(S);
  if (!local.some(v => v.id === R.acting)) R.acting = me.id;
  const key = pkey(S.current, st.round, R.acting);
  const sig = JSON.stringify([S.current, st.started, st.done, st.round, st.votes[st.round] || null, S.parts, R.acting, R.picks[key], R.editing[key], R.confirm, isHost, local.length]);
  if (sig !== R.voteSig) {
    R.voteSig = sig;
    const box = $('#vote-main');
    box.innerHTML = !st.started ? lobbyHTML(S, st, isHost) : !st.done ? votingHTML(S, st, isHost) : doneHTML(S, st, isHost);
    const lq = $('#lobby-qr'); if (lq) lq.innerHTML = R.qr || (R.qr = qrSVG(shareUrl('qr')));
    if (st.done && st.def.kind === 'game') {
      const fk = R.code + '.' + S.current;
      if (!R.fired[fk]) { R.fired[fk] = 1; if (FLIP.busy || FLIP.q.length) FLIP.confetti = true; else confetti(); }
    }
  }
  const needS2 = st.done && st.def.kind === 'type' && isHost && !S.stages[S.current + 1];
  $('#s2-wrap').hidden = !needS2;
  if (needS2) mountS2(S, st);
  updateLockbar();
}
function lobbyHTML(S, st, isHost) {
  const host = S.partMap[S.host];
  let h = '';
  if (isHost && !R.chan.local) h += '<div class="panel lobby-share"><div class="qr-big" id="lobby-qr"></div><div style="display:flex;flex-direction:column;gap:8px;min-width:0"><p class="eyebrow">Get everyone in</p><h2>Scan to join</h2><p class="muted">Hold this up at the table, or send the link from the Invite tab. Works on any phone, no app or account.</p><p class="code-big">' + fmtCode(R.code) + '</p></div></div>';
  if (isHost && R.chan.local) h += '<div class="panel"><p class="eyebrow">One phone</p><h2>Pass it around</h2><p class="muted">Add everyone who’s voting under Invite → “Someone at the table without a phone?” Then use the “Voting as” switch to take turns.</p></div>';
  h += '<div class="panel"><div class="ph"><h3>At the table</h3><span class="pill">' + S.parts.length + '</span></div><ul class="people-inline">' + S.parts.map(p => '<li>' + esc(p.n) + '</li>').join('') + '</ul></div>';
  if (isHost) h += '<button type="button" class="btn big" data-act="start">Start voting' + (S.parts.length > 1 ? ' · ' + S.parts.length + ' voters' : '') + '</button><p class="fine center">Each round closes on its own once everyone has locked in. You can close a round early if someone wanders off.' + (st.def.tb === 'coin' ? ' Tied matchups get a coin flip.' : '') + '</p>';
  else h += '<div class="panel wait"><span class="spin"></span><p>You’re in. ' + esc(host ? host.n : 'The organizer') + ' will start the voting once everyone’s here.</p></div>';
  h += '<div class="panel"><div class="ph"><h3>The field</h3><span class="muted">' + st.n + ' seeded</span></div><ol class="field">' + fieldHTML(st.def) + '</ol></div>';
  return h;
}
function votingHTML(S, st, isHost) {
  const rd = st.rounds[st.round], vs = st.votes[st.round] || {};
  const local = localVoters(S), voter = S.partMap[R.acting] || S.partMap[me.id];
  const key = pkey(S.current, st.round, voter.id);
  const voted = !!vs[voter.id], editing = !!R.editing[key];
  if (!R.picks[key]) R.picks[key] = voted ? vs[voter.id].slice() : rd.matches.map(m => (m.a < 0 || m.b < 0) ? (m.a >= 0 ? m.a : m.b) : null);
  const picks = R.picks[key], interactive = !voted || editing;
  let h = '';
  if (st.round > 0) h += resultsHTML(S, st, st.round - 1);
  if (local.length > 1) h += '<div class="as"><p class="eyebrow">Voting as</p><div class="as-chips">' + local.map(v => '<button type="button" class="as-c' + (v.id === voter.id ? ' on' : '') + '" data-as="' + esc(v.id) + '">' + esc(v.n) + (vs[v.id] ? ' <span class="ok">✓</span>' : '') + '</button>').join('') + '</div></div>';
  const done = S.parts.filter(p => vs[p.id]), wait = S.parts.filter(p => !vs[p.id]);
  const waitNames = wait.slice(0, 4).map(p => p.n).join(', ') + (wait.length > 4 ? ' +' + (wait.length - 4) : '');
  h += '<div class="prog"><div class="prog-bar"><i style="width:' + Math.round(done.length / Math.max(1, S.parts.length) * 100) + '%"></i></div><p><b>' + done.length + ' of ' + S.parts.length + '</b> locked in' + (wait.length ? ' · waiting on ' + esc(waitNames) : '') + '</p></div>';
  if (!interactive) h += '<p class="muted">' + (voter.id === me.id ? 'Your picks are in.' : esc(voter.n) + '’s picks are in.') + ' Here’s how the votes are landing so far.</p>';
  h += '<div class="mus">' + rd.matches.map((m, i) => matchupHTML(st, m, i, picks[i], interactive, vs)).join('') + '</div>';
  if (!interactive) h += '<button type="button" class="btn ghost" data-act="edit">Change ' + (voter.id === me.id ? 'my' : esc(voter.n) + '’s') + ' picks</button>';
  if (isHost) {
    const n = Object.keys(vs).length;
    if (R.confirm === S.current + '.' + st.round) h += '<div class="confirm"><p><b>Close the ' + roundName(rd.matches.length) + ' with ' + n + ' of ' + S.parts.length + ' votes in?</b> Missing votes won’t count. ' + (st.def.tb === 'coin' ? 'Any tied matchups get a coin flip.' : 'Ties go to your pick, then to the better seed.') + '</p><div class="row"><button type="button" class="btn sm" data-act="close-yes">Close the round</button><button type="button" class="btn ghost sm" data-act="close-no">Keep waiting</button></div></div>';
    else if (wait.length) h += '<div class="host-tools"><div><p class="eyebrow">Organizer</p><p class="fine">Someone wander off? Close the round with the votes that are in.</p></div><button type="button" class="btn ghost sm" data-act="close">Close round now</button></div>';
  }
  return h;
}
function matchupHTML(st, m, i, pick, interactive, vs) {
  const E = st.def.ents, games = st.def.kind === 'game';
  if (m.a < 0 || m.b < 0) {
    const w = m.a >= 0 ? m.a : m.b;
    return '<div class="mu bye"><div class="mu-h"><span>Matchup ' + (i + 1) + '</span><span>Bye</span></div><div class="mu-o static"><span class="sd">' + (w + 1) + '</span>' + (games ? thumbHTML(E[w]) : '') + '<span class="mu-t"><b>' + esc(E[w].n) + '</b><small>Top seed, moves on automatically</small></span></div></div>';
  }
  let va = 0, vb = 0;
  for (const id in vs) { const p = vs[id][i]; if (p === m.a) va++; else if (p === m.b) vb++; }
  const tot = va + vb;
  const opt = (e, v) => {
    const on = pick === e, th = games ? thumbHTML(E[e]) : '';
    if (interactive) return '<button type="button" class="mu-o' + (on ? ' on' : '') + '" data-m="' + i + '" data-e="' + e + '" aria-pressed="' + on + '"><span class="sd">' + (e + 1) + '</span>' + th + '<span class="mu-t"><b>' + esc(E[e].n) + '</b><small>' + esc(entSub(st.def, E[e])) + '</small></span><span class="mu-ck" aria-hidden="true"></span></button>';
    const pct = tot ? Math.round(v / tot * 100) : 0;
    return '<div class="mu-o static' + (on ? ' on' : '') + '"><span class="mu-bar" style="width:' + pct + '%"></span><span class="sd">' + (e + 1) + '</span>' + th + '<span class="mu-t"><b>' + esc(E[e].n) + '</b><small>' + esc(entSub(st.def, E[e])) + (on ? ' · your pick' : '') + '</small></span><span class="mu-v" aria-label="' + plural(v, 'vote') + '">' + v + '</span></div>';
  };
  const status = interactive ? (pick != null ? '<span class="picked">Picked</span>' : '<span>Pick one</span>') : '<span>' + (tot ? plural(tot, 'vote') : 'No votes yet') + '</span>';
  return '<div class="mu"><div class="mu-h"><span>Matchup ' + (i + 1) + '</span>' + status + '</div>' + opt(m.a, va) + '<div class="mu-vs"><span>vs</span></div>' + opt(m.b, vb) + '</div>';
}
function resultsHTML(S, st, r) {
  const rd = st.rounds[r], E = st.def.ents, key = S.current + '.' + r;
  const rows = rd.matches.filter(m => m.how !== 'bye').map(m => {
    const w = m.w, l = w === m.a ? m.b : m.a, wv = w === m.a ? m.va : m.vb, lv = w === m.a ? m.vb : m.va;
    const note = m.how === 'coin' ? '<span class="coin-img mini-coin ' + (m.coin === 'T' ? 't' : 'h') + '" aria-hidden="true"></span>Tied, won the coin flip (' + (m.coin === 'T' ? 'tails' : 'heads') + ')' : m.how === 'host' ? 'Tied, the organizer’s pick breaks it' : m.how === 'seed' ? 'Tied, the better seed advances' : '';
    return '<li><b>' + esc(E[w].n) + '</b><span class="score">' + wv + '–' + lv + '</span><span class="lose">' + esc(E[l].n) + '</span>' + (note ? '<small>' + note + '</small>' : '') + '</li>';
  }).join('');
  if (!rows) return '';
  const open = R.resOpen[key] !== false;
  return '<details class="results" data-rk="' + key + '"' + (open ? ' open' : '') + '><summary><span class="eyebrow">' + roundName(rd.matches.length) + ' results</span></summary><ul>' + rows + '</ul></details>';
}
function doneHTML(S, st, isHost) {
  const def = st.def, E = def.ents, c = E[st.champion];
  const fm = st.rounds[st.rounds.length - 1].matches[0];
  const ru = fm && fm.how !== 'bye' ? E[fm.w === fm.a ? fm.b : fm.a] : null;
  const score = fm ? (fm.w === fm.a ? fm.va + '–' + fm.vb : fm.vb + '–' + fm.va) : '';
  const scoreLine = ru ? '<p class="champ-score">Beat ' + esc(ru.n) + ' ' + score + ' in the final' + (fm.how === 'coin' ? ' (won the coin flip)' : fm.how === 'host' ? ' (organizer broke the tie)' : fm.how === 'seed' ? ' (tie went to the better seed)' : '') + '</p>' : '';
  const mark = '<svg class="champ-mark" viewBox="0 0 32 32" aria-hidden="true"><path d="M4 7h9v18H4M13 16h9" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><circle cx="26" cy="16" r="3.6" fill="currentColor"/></svg>';
  const host = S.partMap[S.host];
  if (def.kind === 'type') {
    let h = '<div class="champ">' + mark + '<p class="eyebrow">Tonight’s ' + (def.lens === 'theme' ? 'theme' : 'kind of game') + '</p><h2 class="champ-n">' + esc(c.n) + '</h2><p class="champ-sub">' + (c.c ? plural(c.c, 'game') + ' on the shelf' + (def.cx ? ' for ' + playersText(def.cx.n) : '') : '') + '</p>' + scoreLine + '</div>';
    if (!isHost) h += '<div class="panel wait"><span class="spin"></span><p>' + esc(host ? host.n : 'The organizer') + ' is picking which ' + esc(c.n) + ' games make the final bracket. Stage 2 starts right here.</p></div>';
    return h;
  }
  const src = imgURL(c.im);
  let h = '<div class="champ">' + mark +
    '<div class="champ-head">' + (src ? '<span class="champ-art"><img src="' + esc(src) + '" alt="" referrerpolicy="no-referrer"></span>' : '') + '<p class="eyebrow">Tonight we’re playing</p></div>' +
    '<h2 class="champ-n' + (c.n.length > 18 ? ' long' : '') + '">' + esc(c.n) + '</h2>' +
    '<p class="champ-sub">' + esc(gameSub(c, def.cx && def.cx.n)) + '</p>' + scoreLine +
    '<div class="champ-acts"><a class="btn" href="' + esc(howToURL(c.n)) + '" target="_blank" rel="noopener" data-wa="how_to_play">How to play</a>' +
    (c.i ? '<a class="btn ghost" href="' + esc(bggURL(c.i)) + '" target="_blank" rel="noopener" data-wa="bgg">On BoardGameGeek</a>' : '') + '</div></div>';
  h += '<a class="btn ghost big" href="./" data-ev="' + (isHost ? 'new_bracket' : 'start_own') + '" data-from="champion">' + (isHost ? 'Start a new bracket' : 'Start your own bracket') + '</a>';
  return h;
}

/* stage 2 builder (organizer only) */
async function hostShelf(S) {
  const h = store.get('host.' + R.code, null);
  if (h && h.games && h.games.length) return h.games;
  const q = S.stages[1].def.q;
  if (!q) throw bggErr('noq', 'no shelf');
  const r = await loadShelf(q);
  store.set('host.' + R.code, {games: r.games, at: Date.now()});
  return r.games;
}
async function mountS2(S, st) {
  const def = st.def, c = def.ents[st.champion], lens = def.lens || 'play', key = R.code + ':' + S.current + ':' + c.k;
  if (R.s2 === key) return; R.s2 = key;
  const n = def.cx && def.cx.n;
  const wrap = $('#s2-wrap');
  wrap.innerHTML = '<section class="panel"><p class="eyebrow">Stage 2 · Organizer</p><h2>Pick the ' + esc(c.n) + ' contenders</h2><p class="fine" id="s2-note"></p><div class="pk" id="s2-picker"><p class="loading"><span class="spin"></span><span>Pulling ' + esc(c.n) + ' games off the shelf…</span></p></div><button type="button" class="btn big" id="s2-go" disabled>Start the ' + esc(c.n) + ' bracket</button><button type="button" class="linkbtn" id="s2-skip">Skip stage 2 and just show me the list</button><div id="s2-list"></div></section>';
  let games;
  try { games = await hostShelf(S); }
  catch (e) { $('#s2-picker').innerHTML = '<div class="errbox"><p>We couldn’t load the shelf on this phone. <button type="button" class="linkbtn" id="s2-retry">Try again</button></p></div>'; $('#s2-retry').onclick = () => { R.s2 = null; mountS2(S, st); }; return; }
  const list = byRating(byType(games, lens)[c.k] || []);
  const items = list.map(g => gameItem(g, n));
  const note = o => { $('#s2-note').textContent = o === 'shuf' ? 'Shuffled seeds. Tap Shuffle again for a new draw.' : 'Seeded by rating, so the best-rated game is the 1 seed.'; };
  note('top');
  if (!items.length) { $('#s2-picker').innerHTML = '<p class="muted">No games on this phone’s copy of the shelf fit ' + esc(c.n) + '.</p>'; return; }
  const pk = new Picker($('#s2-picker'), {items, kind: 'game', initial: Math.min(8, items.length), min: 1, onOrder: note, id: 's2'});
  const go = $('#s2-go'); go.disabled = false;
  go.onclick = async () => {
    const ents = pk.entrants(); if (!ents.length) { toast('Pick at least one game.'); return; }
    const d2 = defFrom(S.current + 1, 'game', ents, {mode: def.mode, lens, tb: def.tb, title: c.n + ' Showdown', cx: def.cx, q: def.q, go: 1});
    busy(go, true, 'Starting stage 2…');
    try { await sendVia(R.chan, d2); track('stage2_started', {code: R.code, type: c.n, contenders: ents.length, games_available: items.length}); } catch (e) { toast('Couldn’t start stage 2. Check your connection and try again.'); }
    finally { busy(go, false); }
  };
  $('#s2-skip').onclick = () => {
    track('stage2_skipped', {code: R.code, type: c.n, games_available: list.length});
    $('#s2-list').innerHTML = '<ul class="spots">' + list.slice(0, 20).map(g => '<li><span>' + thumbHTML(g) + '<span><b>' + esc(g.n) + '</b><small>' + esc(gameSub(g, n)) + '</small></span></span><a href="' + esc(bggURL(g.id)) + '" target="_blank" rel="noopener" data-wa="list_bgg">BGG</a></li>').join('') + '</ul>';
  };
}

/* sticky lock-in bar */
function updateLockbar() {
  const bar = $('#lockbar'), S = R.S;
  if (VIEW !== 'room' || R.tab !== 'vote' || !S) { bar.hidden = true; return; }
  const st = S.stages[S.current];
  if (!st.started || st.done) { bar.hidden = true; return; }
  const rd = st.rounds[st.round], vs = st.votes[st.round] || {};
  const voter = S.partMap[R.acting] || S.partMap[me.id]; if (!voter) { bar.hidden = true; return; }
  const key = pkey(S.current, st.round, voter.id);
  if (vs[voter.id] && !R.editing[key]) { bar.hidden = true; return; }
  const picks = R.picks[key] || [];
  const need = rd.matches.filter((m, i) => m.a >= 0 && m.b >= 0 && picks[i] == null).length;
  const b = $('#lock-btn'); bar.hidden = false; b.disabled = need > 0;
  const who = voter.id === me.id ? '' : ' for ' + voter.n;
  b.textContent = need ? plural(need, 'matchup') + ' left to pick' : 'Lock in picks' + who;
}
async function lockIn() {
  const S = R.S, st = S.stages[S.current], voter = S.partMap[R.acting] || S.partMap[me.id];
  const key = pkey(S.current, st.round, voter.id), picks = R.picks[key];
  if (!picks || picks.some((p, i) => p == null && st.rounds[st.round].matches[i].a >= 0 && st.rounds[st.round].matches[i].b >= 0)) return;
  const b = $('#lock-btn'); busy(b, true, 'Locking in…');
  try {
    await sendVia(R.chan, {t: 'vote', s: S.current, r: st.round, id: voter.id, n: voter.n, p: picks.map(p => (p == null ? null : p))});
    track('picks_locked', {code: R.code, stage: S.current, round: st.round, round_name: roundName(st.rounds[st.round].matches.length), for_no_phone_voter: voter.id !== me.id, changed_picks: !!R.editing[key], is_organizer: S.host === me.id});
    R.editing[key] = false;
    const vs = (R.S.stages[S.current].votes[st.round]) || {};
    const next = localVoters(R.S).find(v => v.id !== voter.id && !vs[v.id]);
    if (next && R.S.stages[S.current].round === st.round) { R.acting = next.id; toast('Locked in. Hand the phone to ' + next.n + '.'); }
    else toast('Picks locked in.');
    renderRoom();
  } catch (e) { toast('Couldn’t send your picks. Check your connection and try again.'); }
  finally { busy(b, false); updateLockbar(); }
}
function initRoom() {
  $$('.tab').forEach(b => { b.onclick = () => setTab(b.dataset.tab); });
  $('#codechip').onclick = () => { if (VIEW === 'room') setTab('invite'); };
  $('#lock-btn').onclick = lockIn;
  $('#vote-main').addEventListener('toggle', e => { const d = e.target; if (d && d.dataset && d.dataset.rk) R.resOpen[d.dataset.rk] = d.open; }, true);
  $('#vote-main').onclick = async e => {
    const S = R.S; if (!S) return;
    const st = S.stages[S.current];
    const opt = e.target.closest('button.mu-o[data-m]');
    if (opt) {
      const key = pkey(S.current, st.round, R.acting);
      const picks = R.picks[key]; if (!picks) return;
      picks[+opt.dataset.m] = +opt.dataset.e; R.voteSig = null; renderVote(S, st, S.host === me.id);
      const all = st.rounds[st.round].matches.every((m, i) => picks[i] != null);
      if (!all) { const nextEl = $$('#vote-main .mu')[+opt.dataset.m + 1]; if (nextEl && window.innerWidth < 700) nextEl.scrollIntoView({behavior: 'smooth', block: 'center'}); }
      return;
    }
    const as = e.target.closest('[data-as]');
    if (as) { R.acting = as.dataset.as; R.voteSig = null; renderVote(S, st, S.host === me.id); return; }
    const act = e.target.closest('[data-act]'); if (!act) return;
    const a = act.dataset.act;
    if (a === 'edit') { const key = pkey(S.current, st.round, R.acting); R.editing[key] = true; R.picks[key] = (st.votes[st.round] || {})[R.acting].slice(); R.voteSig = null; renderVote(S, st, S.host === me.id); }
    else if (a === 'start') { busy(act, true, 'Starting…'); try { await sendVia(R.chan, {t: 'start', s: S.current, host: me.id}); track('voting_started', {code: R.code, stage: S.current, voters: S.parts.length, no_phone_voters: S.parts.filter(p => p.by).length}); } catch (x) { busy(act, false); toast('Couldn’t start voting. Check your connection and try again.'); } }
    else if (a === 'close') { R.confirm = S.current + '.' + st.round; R.voteSig = null; renderVote(S, st, true); }
    else if (a === 'close-no') { R.confirm = null; R.voteSig = null; renderVote(S, st, true); }
    else if (a === 'close-yes') { R.confirm = null; busy(act, true, 'Closing…'); try { await sendVia(R.chan, {t: 'close', s: S.current, r: st.round, host: me.id}); } catch (x) { busy(act, false); toast('Couldn’t close the round. Try again.'); } }
  };
  $('#btn-copy').onclick = async () => {
    const url = shareUrl('link');
    track('invite_shared', {code: R.code, method: 'copy'});
    try { await navigator.clipboard.writeText(url); toast('Link copied'); }
    catch (e) { const i = $('#inv-url'); i.focus(); i.select(); toast('Press and hold to copy the link'); }
  };
  if (navigator.share) {
    $('#btn-share').hidden = false;
    $('#btn-share').onclick = () => { navigator.share({title: 'Game Night Madness', text: 'Help pick what we play tonight. Vote in the bracket:', url: shareUrl('share')}).then(() => track('invite_shared', {code: R.code, method: 'share_sheet'})).catch(() => {}); };
  }
  $('#proxy-form').onsubmit = async e => {
    e.preventDefault();
    const n = $('#proxy-name').value.trim().slice(0, 24); if (!n) { $('#proxy-name').focus(); return; }
    const id = rid(12), list = store.get('proxies.' + R.code, []);
    list.push({id, n}); store.set('proxies.' + R.code, list);
    try { await sendVia(R.chan, {t: 'join', id, n, by: me.id}); track('proxy_added', {code: R.code}); $('#proxy-name').value = ''; toast(n + ' is in. Switch to them under “Voting as” on the Vote tab.', 3800); }
    catch (x) { toast('Couldn’t add ' + n + '. Check your connection and try again.'); }
  };
}

/* bracket tab */
function renderBracket() {
  const S = R.S; if (!S) return;
  const stages = Object.keys(S.stages).map(Number).sort((a, b) => a - b);
  if (!R.bk || !S.stages[R.bk]) R.bk = S.current;
  let h = '';
  if (stages.length > 1) h += '<div class="seg stage-sw" role="group" aria-label="Which bracket">' + stages.map(s => '<button type="button" data-bk="' + s + '" aria-pressed="' + (s === R.bk) + '">' + esc(S.stages[s].def.kind === 'type' ? (S.stages[s].def.lens === 'theme' ? 'Theme' : 'Game type') : S.stages[s].def.title.replace(/ Showdown$/, '')) + '</button>').join('') + '</div>';
  h += bracketHTML(S.stages[R.bk]);
  $('#bk-box').innerHTML = h;
  $$('[data-bk]', $('#bk-box')).forEach(b => { b.onclick = () => { R.bk = +b.dataset.bk; renderBracket(); }; });
}

/* invite tab */
function renderInvite(S) {
  if (!R.qr) R.qr = qrSVG(shareUrl('qr'));
  if ($('#inv-qr').dataset.code !== R.code) { $('#inv-qr').innerHTML = R.qr; $('#inv-qr').dataset.code = R.code; }
  $('#inv-url').value = shareUrl('link'); $('#inv-code').textContent = fmtCode(R.code);
  $('#inv-file').hidden = location.protocol !== 'file:' || !!R.chan.local;
  $('#inv-local').hidden = !R.chan.local;
  $('#inv-online-qr').hidden = !!R.chan.local; $('#inv-online-link').hidden = !!R.chan.local;
  if (R.chan.local) $('#btn-share').hidden = true;
  const st = S.stages[S.current], vs = st.started && !st.done ? (st.votes[st.round] || {}) : null;
  $('#inv-count').textContent = S.parts.length;
  $('#inv-people').innerHTML = S.parts.map(p => {
    const tags = (p.id === S.host ? '<small>organizer</small>' : '') + (p.id === me.id ? '<small>you</small>' : '') + (p.by && S.partMap[p.by] ? '<small>on ' + esc(S.partMap[p.by].n) + '’s phone</small>' : '');
    return '<li><span class="av" aria-hidden="true">' + esc(p.n.charAt(0)) + '</span><span class="pn">' + esc(p.n) + tags + '</span>' + (vs ? (vs[p.id] ? '<span class="pill ok">Locked in</span>' : '<span class="pill">Picking</span>') : '') + '</li>';
  }).join('');
}

/* coin flip */
function coinHTML(size, thick) {
  let layers = ''; const n = 9;
  for (let i = 0; i < n; i++) layers += '<span class="layer" style="transform:translateZ(' + (-thick / 2 + thick * (i + 0.5) / n).toFixed(2) + 'px)"></span>';
  return '<span class="coin3d" style="--cs:' + size + 'px;--ct:' + thick + 'px">' + layers + '<span class="face h"></span><span class="face t"></span></span>';
}
const reducedMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };
function tossCoin(lift, side, o) {
  o = Object.assign({dur: 1700, turns: 5, height: 120, shadow: null}, o || {});
  const coin = lift.querySelector('.coin3d'), endDeg = side === 'T' ? 180 : 0;
  [coin, lift, o.shadow].forEach(el => el && el.getAnimations && el.getAnimations().forEach(a => a.cancel()));
  if (reducedMotion() || !coin.animate) { coin.style.transform = 'rotateX(' + endDeg + 'deg)'; return Promise.resolve(); }
  coin.style.transform = '';
  const end = o.turns * 360 + endDeg, opts = {duration: o.dur, fill: 'forwards'};
  const anims = [
    coin.animate([{transform: 'rotateX(0deg)', easing: 'cubic-bezier(.3,.55,.45,1)'}, {transform: 'rotateX(' + end + 'deg)', offset: 0.82}, {transform: 'rotateX(' + end + 'deg)'}], opts),
    lift.animate([
      {transform: 'translateY(0)', easing: 'cubic-bezier(.2,.7,.4,1)'},
      {transform: 'translateY(-' + o.height + 'px)', offset: 0.42, easing: 'cubic-bezier(.6,0,.85,.4)'},
      {transform: 'translateY(0)', offset: 0.82, easing: 'ease-out'},
      {transform: 'translateY(-' + Math.round(o.height * 0.08) + 'px)', offset: 0.91, easing: 'ease-in'},
      {transform: 'translateY(0)'}], opts)];
  if (o.shadow) anims.push(o.shadow.animate([{transform: 'scale(1)', opacity: 1}, {transform: 'scale(.45)', opacity: .35, offset: 0.42}, {transform: 'scale(1)', opacity: 1, offset: 0.82}, {transform: 'scale(1)', opacity: 1}], opts));
  FLIP.anims = anims;
  return Promise.all(anims.map(a => a.finished.catch(() => {})));
}
const FLIP = {q: [], busy: false, seen: {}, init: false, skip: false, next: null, confetti: false, anims: []};
function queueFlips(S) {
  const first = !FLIP.init; FLIP.init = true;
  Object.keys(S.stages).forEach(k => {
    const st = S.stages[k];
    st.rounds.forEach((rd, r) => {
      if (!rd.closed) return;
      rd.matches.forEach((m, i) => {
        if (m.how !== 'coin') return;
        const key = R.code + '.' + k + '.' + r + '.' + i;
        if (FLIP.seen[key]) return;
        FLIP.seen[key] = 1;
        if (!first) FLIP.q.push({E: st.def.ents, m, rname: roundName(rd.matches.length)});
      });
    });
  });
  if (FLIP.q.length && !FLIP.busy) runFlips();
}
function flipWait(ms) {
  return new Promise(res => { if (FLIP.skip) return res(); const t = setTimeout(done, ms); function done() { clearTimeout(t); FLIP.next = null; res(); } FLIP.next = done; });
}
function callHTML(E, e, side) {
  return '<span class="coin-img ' + (side === 'T' ? 't' : 'h') + '" aria-hidden="true"></span><span><small>' + (side === 'T' ? 'Tails' : 'Heads') + '</small><b>' + esc(E[e].n) + '</b></span>';
}
async function runFlips() {
  FLIP.busy = true; FLIP.skip = false;
  const ov = $('#flip'), lift = $('#flip-lift'), next = $('#flip-next'), res = $('#flip-result');
  ov.hidden = false; document.body.classList.add('noscroll');
  let shown = 0;
  while (FLIP.q.length && !FLIP.skip) {
    const t = FLIP.q.shift(); shown++;
    const total = shown + FLIP.q.length, E = t.E, m = t.m;
    const hd = Math.min(m.a, m.b), tl = Math.max(m.a, m.b), winH = m.coin !== 'T';
    $('#flip-count').textContent = 'Tiebreaker' + (total > 1 ? ' ' + shown + ' of ' + total : '') + ' · ' + t.rname;
    $('#flip-title').textContent = E[hd].n + ' vs ' + E[tl].n;
    $('#flip-score').textContent = m.va + m.vb ? 'Tied ' + m.va + '–' + m.vb + '. Better seed takes heads.' : 'No votes on this one. Better seed takes heads.';
    const ch = $('#flip-h'), ct = $('#flip-t');
    ch.className = 'flip-call'; ct.className = 'flip-call';
    ch.innerHTML = callHTML(E, hd, 'H'); ct.innerHTML = callHTML(E, tl, 'T');
    res.textContent = ''; res.classList.remove('pop'); next.hidden = true;
    const coin = lift.querySelector('.coin3d'); coin.getAnimations && coin.getAnimations().forEach(a => a.cancel()); coin.style.transform = '';
    await flipWait(450);
    if (FLIP.skip) break;
    await tossCoin(lift, m.coin, {dur: total > 2 ? 1400 : 1800, turns: total > 2 ? 4 : 5, height: 120, shadow: $('#flip-shadow')});
    try { navigator.vibrate && navigator.vibrate(25); } catch (e) {}
    ch.classList.add(winH ? 'win' : 'lose'); ct.classList.add(winH ? 'lose' : 'win');
    void res.offsetWidth; res.classList.add('pop');
    res.textContent = (winH ? 'Heads! ' : 'Tails! ') + E[winH ? hd : tl].n + ' advances';
    next.textContent = FLIP.q.length ? 'Next tiebreaker' : 'See the results';
    next.hidden = false;
    await flipWait(FLIP.q.length ? 2000 : 2600);
  }
  ov.hidden = true; document.body.classList.remove('noscroll'); FLIP.busy = false;
  track('coin_flips_shown', {code: R.code, shown, skipped: FLIP.skip, left_unshown: FLIP.q.length});
  FLIP.q.length = 0; FLIP.skip = false;
  if (FLIP.confetti) { FLIP.confetti = false; confetti(); }
}
function initCoin() {
  $('#flip-lift').innerHTML = coinHTML(160, 12);
  $('#coin-demo-lift').innerHTML = coinHTML(64, 5);
  $('#flip-next').onclick = () => { if (FLIP.next) FLIP.next(); };
  $('#flip-skip').onclick = () => { FLIP.skip = true; FLIP.anims.forEach(a => { try { a.finish(); } catch (e) {} }); if (FLIP.next) FLIP.next(); };
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && FLIP.busy) $('#flip-skip').click(); });
  let demoBusy = false;
  $('#coin-demo').onclick = async () => {
    if (demoBusy) return; demoBusy = true;
    const side = Math.random() < 0.5 ? 'H' : 'T';
    $('#coin-demo-title').textContent = 'Flipping…';
    await tossCoin($('#coin-demo-lift'), side, {dur: 1300, turns: 3, height: 26});
    $('#coin-demo-title').textContent = side === 'H' ? 'Heads: the better seed advances.' : 'Tails: the lower seed advances.';
    $('#coin-demo-sub').textContent = 'That’s how tied matchups are settled, and every phone sees the same flip.';
    track('coin_demo_flipped', {side});
    demoBusy = false;
  };
}

/* celebration */
function confetti() {
  try { if (matchMedia('(prefers-reduced-motion: reduce)').matches) return; } catch (e) {}
  const cv = $('#fx'), ctx = cv.getContext('2d'); if (!ctx) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1), W = innerWidth, H = innerHeight;
  cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cs = getComputedStyle(document.documentElement);
  const cols = ['--accent', '--gold', '--ok', '--ink'].map(v => cs.getPropertyValue(v).trim() || '#5B3FD0');
  const P = Array.from({length: 120}, () => ({x: W / 2 + (Math.random() - 0.5) * W * 0.3, y: H * 0.3, vx: (Math.random() - 0.5) * 12, vy: -Math.random() * 11 - 4, s: Math.random() * 7 + 5, a: Math.random() * 6.3, va: (Math.random() - 0.5) * 0.35, c: cols[Math.floor(Math.random() * cols.length)]}));
  let t = 0;
  (function frame() {
    ctx.clearRect(0, 0, W, H);
    P.forEach(p => { p.vy += 0.3; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.a += p.va; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore(); });
    if (++t < 170) requestAnimationFrame(frame); else ctx.clearRect(0, 0, W, H);
  })();
}

/* ---------- boot ---------- */
function route() {
  const code = (new URLSearchParams(location.search).get('b') || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  track('app_opened', {entry: code ? 'bracket_link' : 'home', via: VIA || 'direct', first_visit: FIRST_VISIT, standalone: !!(window.matchMedia && matchMedia('(display-mode: standalone)').matches)});
  if (code.length >= 6 && code.length <= 16) openRoom(code);
  else showSetup();
}
if (window.GNM_TEST) window.GNM = {parseCollection, parseThings, typesOf, byType, typeItems, verdict, fitsBasic, fitsMore, loadShelf, shelfItem, sampleShelf, defFrom, gameItem, derive, gameSub, imgURL, imgPath, TYPES, CFG, store};
$('#preview-banner').hidden = !PREVIEW;
$('#foot-an').hidden = AN.dead; $('#join-an').hidden = AN.dead;
document.addEventListener('error', e => { const t = e.target; if (t && t.tagName === 'IMG' && t.closest && t.closest('.th, .champ-art, .bgg-badge')) { const box = t.closest('.champ-art'); t.remove(); if (box) box.remove(); } }, true);
$$('.bgg-badge img').forEach(i => { if (i.complete && !i.naturalWidth) i.remove(); });
loadAnalytics();
initCoin();
initSetup(); initBuild(); initJoin(); initRoom();
document.addEventListener('click', e => {
  const t = e.target.closest && e.target.closest('[data-wa],[data-ev]'); if (!t) return;
  const org = !!(R.S && R.S.host === me.id);
  if (t.dataset.wa) track('winner_action', {code: R.code, action: t.dataset.wa, is_organizer: org});
  else track(t.dataset.ev === 'new_bracket' ? 'new_bracket_clicked' : 'start_own_clicked', {code: R.code, from: t.dataset.from || null, is_organizer: org});
}, true);
window.addEventListener('popstate', () => location.reload());
route();
})();
