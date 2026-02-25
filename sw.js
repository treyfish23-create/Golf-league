// FairwayCaddie Service Worker — cache shell, network-first for Firebase
const CACHE = 'fairwaycaddie-v17';
const SHELL = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/firebase-config.js',
  '/firestore-sync.js',
  '/auth.js',
  '/approval.js',
  '/logo.png',
  '/icon-192.png',
  '/icon-512.png'
];

// Message handler — allows page to force SW activation (critical for iOS)
self.addEventListener('message', e => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

// Install: pre-cache the app shell
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

// Activate: clean old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: network-first for Firebase APIs, cache-first for static assets
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Skip non-GET requests
  if (e.request.method !== 'GET') return;

  // Network-first for Firebase & Google APIs (auth, firestore, analytics)
  if (url.hostname.includes('googleapis.com') ||
      url.hostname.includes('gstatic.com') ||
      url.hostname.includes('google.com') ||
      url.hostname.includes('firebaseio.com')) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
    return;
  }

  // Network-first for Google Fonts CSS (may update)
  if (url.hostname === 'fonts.googleapis.com') {
    e.respondWith(
      fetch(e.request)
        .then(r => { caches.open(CACHE).then(c => c.put(e.request, r.clone())); return r; })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Cache-first for font files (woff2 — rarely change)
  if (url.hostname === 'fonts.gstatic.com') {
    e.respondWith(
      caches.match(e.request).then(r => r || fetch(e.request).then(resp => {
        caches.open(CACHE).then(c => c.put(e.request, resp.clone()));
        return resp;
      }))
    );
    return;
  }

  // Cache-first for app shell, with network fallback
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
