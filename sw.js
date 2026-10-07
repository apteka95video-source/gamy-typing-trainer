// Сервіс-воркер: після першого завантаження базове навчання працює без мережі.
// Стратегія «спершу мережа, інакше кеш»: онлайн завжди свіжа версія, офлайн — остання збережена.

const CACHE = 'gamy-v1';
const CORE = [
  './',
  'index.html',
  'favicon.svg',
  'manifest.webmanifest',
  'assets/styles.css',
  'src/main.js',
  'src/core/adaptive.js',
  'src/core/analysis.js',
  'src/core/config.js',
  'src/core/engine.js',
  'src/core/layouts.js',
  'src/core/metrics.js',
  'src/core/progress.js',
  'src/core/rng.js',
  'src/core/storage.js',
  'src/core/text.js',
  'src/ui/dom.js',
  'src/ui/keyboard.js',
  'src/ui/trainer.js',
  'src/ui/views.js',
  'data/curriculum/uk.json',
  'data/curriculum/en.json',
  'data/derived/uk/words.json',
  'data/derived/en/words.json',
  'data/derived/build-report.json',
  'dictionaries/manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request, { ignoreSearch: true }).then((cached) => cached ?? caches.match('index.html'))),
  );
});
