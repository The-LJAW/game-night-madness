/* Game Night Madness service worker.
   Chrome only offers its "Install app" prompt to sites that have one, and it lets the installed app
   open when the phone is offline. It never shows an old version while the network works: every
   request goes to the network first, and the saved copy is used only when that fails.
   Requests to other sites (the voting relay, the BGG helper, box art) are left alone. */
const CACHE = 'gnm-shell-v1';
const SHELL = ['./', 'manifest.webmanifest', 'powered-by-bgg.png', 'icons/icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('gnm-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  // One saved copy per page, whatever bracket code (?b=...) it was opened with.
  const key = req.mode === 'navigate' ? url.origin + url.pathname : req;
  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') {
        const copy = res.clone();
        e.waitUntil(caches.open(CACHE).then(c => c.put(key, copy)).catch(() => {}));
      }
      return res;
    } catch (err) {
      const saved = await caches.match(key);
      if (saved) return saved;
      throw err;
    }
  })());
});
