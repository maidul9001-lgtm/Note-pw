/* নোটপ্যাডের সার্ভিস ওয়ার্কার: অফলাইনে চালানোর জন্য অ্যাপ ফাইল ক্যাশ করে রাখে।
   index.html বদলালে নিচের VER সংখ্যা বাড়িয়ে দিলে পুরনো ক্যাশ মুছে নতুন ফাইল আসবে। */
const VER = 'notepad-v1';
const CORE = [
  './',
  './index.html',
  './manifest.json',
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
  if (u.origin !== location.origin) return;

  const isPage = r.mode === 'navigate' || u.pathname.endsWith('.html') || u.pathname.endsWith('/');
  if (isPage) {
    /* পেজ: আগে নেটওয়ার্ক (নতুন সংস্করণ পেতে), ধীর বা অফলাইন হলে ক্যাশ */
    const key = new Request(u.origin + u.pathname);
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
  /* আইকন, ম্যানিফেস্ট ইত্যাদি: আগে ক্যাশ */
  e.respondWith(
    caches.match(r).then(m => m || fetch(r).then(res => {
      if (res && res.ok) { const cp = res.clone(); caches.open(VER).then(c => c.put(r, cp)); }
      return res;
    }))
  );
});
