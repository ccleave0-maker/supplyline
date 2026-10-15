// Service worker for the web app (installable PWA):
// - Pages and static files: network first, the cached copy when offline.
//   (The data on screen comes from the app's own offline copies; API calls are never cached here.)
// - Push notifications: shows them, and opens the right screen when tapped.
const CACHE = 'supplyline-shell-v2';
const SHELL = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then((hit) => hit || caches.match('/'))),
  );
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Bowron', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Bowron';
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, { body: data.body || '', tag: data.tag, icon: '/icon-192.png', badge: '/icon-192.png', data: { link: data.link || '/notifications/' } }),
      typeof data.badge === 'number' && self.navigator && 'setAppBadge' in self.navigator ? self.navigator.setAppBadge(data.badge).catch(() => undefined) : undefined,
    ]),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ('focus' in w) {
          w.navigate(link).catch(() => undefined);
          return w.focus();
        }
      }
      return self.clients.openWindow(link);
    }),
  );
});
