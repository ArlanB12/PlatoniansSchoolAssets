// ============================================================
// Platonian's School Assets — Service Worker (v10.16)
// ============================================================
// Handles real OS-level push notifications. Must be served from
// the site root (public/) so its scope covers every page.
//
// Lifecycle:
//   install  -> activate immediately (skipWaiting)
//   activate -> claim all open clients
//   push     -> show a notification in the device tray
//   click    -> focus an open tab or open the linked page
// ============================================================

// ── v10.17: static asset caching ───────────────────────────
// The app is a multi-page site, so every navigation re-fetches
// the same CSS/JS/font/image files. That round-trip is what made
// switching nav items feel sluggish. We cache static assets with
// a stale-while-revalidate strategy: serve instantly from cache,
// then refresh in the background. API calls and HTML are always
// fetched live so data and auth stay correct.
const CACHE_NAME = 'platonians-static-v10.25';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Drop old caches from previous versions.
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Only cache same-origin static assets. Never cache API responses,
// HTML documents, or anything with auth/state.
function isCacheableStatic(url) {
  if (url.origin !== self.location.origin) {
    // Allow the Google Fonts stylesheet + font files (read-only, public).
    return /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  }
  if (url.pathname.includes('/api/')) return false;
  return /\.(css|js|png|jpe?g|webp|svg|gif|ico|woff2?|ttf|otf)$/i.test(url.pathname);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (!isCacheableStatic(url)) return; // let the network handle it

  // v10.21: JS is NETWORK-FIRST. A stale-while-revalidate strategy on
  // scripts meant a code fix only landed on the SECOND reload (first
  // reload served the old cached file, then refreshed in the background).
  // That made the approve/reject loop "come back" even after it was
  // fixed. Scripts now always try the network first and only fall back
  // to cache when offline. CSS / images / fonts keep the fast
  // stale-while-revalidate path.
  const isScript = /\.js$/i.test(url.pathname);

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);

    if (isScript) {
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.status === 200) cache.put(req, fresh.clone());
        return fresh;
      } catch (e) {
        const cached = await cache.match(req);
        return cached || fetch(req);
      }
    }

    const cached = await cache.match(req);
    const network = fetch(req).then((res) => {
      if (res && res.status === 200) cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    // Serve cache immediately if we have it; otherwise wait for network.
    return cached || (await network) || fetch(req);
  })());
});

// ── Incoming push from the server ──────────────────────────
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    // Fallback: treat the raw payload as the body text.
    data = { title: "Platonian's IS", body: event.data ? event.data.text() : '' };
  }

  const title = data.title || "Platonian's IS";
  const options = {
    body:  data.body || '',
    icon:  'assets/img/logo.png',
    badge: 'assets/img/logo.png',
    tag:   data.type || 'platonians-notif',   // collapse same-type spam
    renotify: true,
    data: {
      link: data.link || 'dashboard.html',
    },
    // Vibration is a no-op on desktop but adds a buzz on phones.
    vibrate: [120, 60, 120],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ── Tapping a notification ─────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const rawLink = (event.notification.data && event.notification.data.link) || 'dashboard.html';

  // BUG FIX v10.19: client.navigate() and clients.openWindow() require an
  // absolute URL in all browsers (the spec is strict; Firefox and Safari
  // reject relative paths entirely). Build an absolute URL from the SW scope.
  const base = self.registration.scope; // e.g. "https://example.com/"
  const link = rawLink.startsWith('http') ? rawLink : base + rawLink;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Find an open tab whose URL ends with the target link and focus it.
      for (const client of clients) {
        if (client.url && client.url.includes(rawLink) && 'focus' in client) {
          client.focus();
          return;
        }
      }
      // Fall back to any open tab of the app, then navigate it to the link.
      for (const client of clients) {
        if ('focus' in client) {
          client.focus();
          if ('navigate' in client) {
            try { client.navigate(link); } catch (e) { /* cross-origin guard */ }
          }
          return;
        }
      }
      // Otherwise open a fresh tab.
      if (self.clients.openWindow) {
        return self.clients.openWindow(link);
      }
    })
  );
});
