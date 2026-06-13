const CACHE_STATIC  = 'jarapp-static-v3';
const CACHE_DYNAMIC = 'jarapp-dynamic-v3';

// Assets estáticos — siempre desde caché
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/favicon.svg',
];

// Instalar — pre-cachear assets estáticos
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_STATIC)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activar — limpiar cachés viejos
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_STATIC && k !== CACHE_DYNAMIC)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch — estrategia por tipo de request
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;

  // Supabase API — Network first, caché como fallback offline
  if (url.hostname.includes('supabase.co')) {
    event.respondWith(networkFirstWithCache(request, CACHE_DYNAMIC));
    return;
  }

  // APIs externas (Groq, etc.) — solo network, no cachear
  if (url.origin !== self.location.origin) return;

  // Assets estáticos (JS, CSS, fuentes, imágenes) — caché first
  if (
    request.destination === 'script' ||
    request.destination === 'style'  ||
    request.destination === 'font'   ||
    request.destination === 'image'  ||
    url.pathname.endsWith('.js')     ||
    url.pathname.endsWith('.css')    ||
    url.pathname.endsWith('.woff2')  ||
    url.pathname.endsWith('.svg')    ||
    url.pathname.endsWith('.png')
  ) {
    event.respondWith(cacheFirstWithNetwork(request, CACHE_STATIC));
    return;
  }

  // HTML y navegación — Network first
  event.respondWith(networkFirstWithCache(request, CACHE_DYNAMIC));
});

// Estrategia: caché primero, red como fallback
async function cacheFirstWithNetwork(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Sin conexión', { status: 503 });
  }
}

// Estrategia: red primero, caché como fallback
async function networkFirstWithCache(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;

    // Fallback offline para navegación → devolver index.html cacheado
    if (request.destination === 'document') {
      const index = await caches.match('/');
      if (index) return index;
    }

    return new Response(
      JSON.stringify({ error: 'Sin conexión', offline: true }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// Mensajes desde la app
self.addEventListener('message', (event) => {
  if (event.data?.type === 'CLEAR_CACHE') {
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))));
  }
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
