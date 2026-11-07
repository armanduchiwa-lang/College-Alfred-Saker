const CACHE = 'suivi-assiduite-v3';
const FICHIERS_STATIQUES = ['/', '/manifest.json', '/icon-192.png', '/icon-512.png', '/entete.png'];

self.addEventListener('install', (evt) => {
  evt.waitUntil(
    caches.open(CACHE).then((cache) => Promise.all(FICHIERS_STATIQUES.map((f) => cache.add(f).catch(() => {}))))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (evt) => {
  evt.waitUntil(
    caches.keys().then((noms) => Promise.all(noms.filter(n => n !== CACHE).map(n => caches.delete(n))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (evt) => {
  // Seules les requêtes GET sont gérées (jamais les envois de données)
  if (evt.request.method !== 'GET') return;
  const url = new URL(evt.request.url);
  // Les données passent toujours par le réseau (jamais de cache pour /api/)
  if (url.pathname.startsWith('/api/')) return;
  // Le reste (page, manifest, icônes) : réseau en priorité, repli sur le cache si hors-ligne
  evt.respondWith(
    fetch(evt.request).then((rep) => {
      // On ne met en cache que les réponses valides (jamais une erreur 404/500)
      if (rep && rep.ok) {
        const copie = rep.clone();
        caches.open(CACHE).then((cache) => cache.put(evt.request, copie)).catch(()=>{});
      }
      return rep;
    }).catch(() => caches.match(evt.request, { ignoreSearch: true }).then((r) => r || caches.match('/')))
  );
});
