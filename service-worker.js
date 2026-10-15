/* নোটপ্যাড PWA – সার্ভিস ওয়ার্কার
   অ্যাপ আপডেট করলে নিচের CACHE_VERSION বদলে দিন (v1 -> v2 ...) */
const CACHE_VERSION = 'v1';
const CACHE_NAME = 'notepad-' + CACHE_VERSION;

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './api/firebase-config.js',
  './api/sync.js',
  './icons/favicon-48.png',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-192.png',
  './icons/maskable-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      /* একটা ফাইল না পেলেও ইনস্টল যেন আটকে না যায় */
      Promise.all(APP_SHELL.map(url =>
        cache.add(url).catch(err => console.warn('cache miss:', url, err))
      ))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k.startsWith('notepad-') && k !== CACHE_NAME)
            .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  /* Firebase/অন্য সাইটের রিকোয়েস্টে হাত দেব না (সিঙ্ক ঠিক থাকবে) */
  if (url.origin !== self.location.origin) return;

  /* পেজ নেভিগেশন: আগে নেটওয়ার্ক, না পেলে ক্যাশের index.html */
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(c => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html').then(r => r || caches.match('./')))
    );
    return;
  }

  /* বাকি ফাইল (আইকন, js): আগে ক্যাশ, পাশাপাশি পেছনে আপডেট */
  event.respondWith(
    caches.match(req).then(cached => {
      const fresh = fetch(req).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || fresh;
    })
  );
});
