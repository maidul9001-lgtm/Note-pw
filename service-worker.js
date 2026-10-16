/* নোটপ্যাডের সার্ভিস ওয়ার্কার (PWA): অ্যাপের ফাইল ক্যাশ করে ইন্টারনেট ছাড়াও চালায়।
   index.html, api/ বা অন্য ফাইল বদলালে নিচের VER সংখ্যা বাড়িয়ে দিন (notepad-v2 → notepad-v3),
   তাহলে পুরনো ক্যাশ মুছে নতুন ফাইল আসবে।
   শুধু ব্রাউজার/PWA-তে চলে; APK অ্যাপে এটা চালু হয় না। */
const VER = 'notepad-v2';
const CORE = [
  './',
  './index.html',
  './manifest.json',
  './api/firebase-config.js',
  './api/sync.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-48.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(VER)
      .then(c => Promise.all(CORE.map(u => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== VER).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin !== location.origin) return;            /* Firebase ইত্যাদি বাইরের অনুরোধে হাত দেয় না */

  const isPage = r.mode === 'navigate' || u.pathname.endsWith('/') || /\.(html|js|json)$/.test(u.pathname);
  if (isPage) {
    /* পেজ, কোড ও কনফিগ: আগে নেটওয়ার্ক (নতুন সংস্করণ পেতে), ধীর বা অফলাইন হলে ক্যাশ */
    const key = r.mode === 'navigate' ? new Request(u.origin + u.pathname) : r;
    e.respondWith(
      caches.match(key, { ignoreSearch: true }).then(cached => {
        const net = fetch(r).then(res => {
          if (res && res.ok) { const cp = res.clone(); caches.open(VER).then(c => c.put(key, cp)); }
          return res;
        });
        if (!cached) return net.catch(() => caches.match('./index.html'));
        return Promise.race([net, new Promise(res => setTimeout(() => res(cached), 2500))]).catch(() => cached);
      })
    );
    return;
  }
  /* আইকন, ছবি: আগে ক্যাশ */
  e.respondWith(
    caches.match(r).then(m => m || fetch(r).then(res => {
      if (res && res.ok) { const cp = res.clone(); caches.open(VER).then(c => c.put(r, cp)); }
      return res;
    }))
  );
});
