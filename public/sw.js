const CACHE_NAME = 'dreamline-cache-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/manifest.json',
  '/favicon.ico',
  '/logo.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Intercept PWA Web Share Target POST requests containing images
  if (event.request.method === 'POST' && url.pathname === '/share-target') {
    event.respondWith((async () => {
      try {
        const formData = await event.request.formData();
        const mediaFile = formData.get('media');

        if (mediaFile && mediaFile instanceof File && mediaFile.size > 0) {
          const arrayBuffer = await mediaFile.arrayBuffer();
          const uint8 = new Uint8Array(arrayBuffer);
          
          // Convert array buffer to base64 safely
          let binary = "";
          const len = uint8.byteLength;
          for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(uint8[i]);
          }
          const base64 = btoa(binary);
          const mimeType = mediaFile.type || "image/jpeg";
          const dataUrl = `data:${mimeType};base64,${base64}`;

          // Save the base64 data URL to Cache Storage client-side
          const cache = await caches.open('shared-receipt-cache');
          await cache.put('/shared-image-temp', new Response(dataUrl));

          return Response.redirect('/?tab=expenses&sharedFromSW=true', 303);
        }
      } catch (err) {
        console.error("Service worker failed to intercept shared file:", err);
      }
      return Response.redirect('/?tab=expenses&shareError=SW_FAILED', 303);
    })());
    return;
  }

  // Only intercept GET requests for general PWA caching
  if (event.request.method !== 'GET') return;

  // Network-first caching strategy: try fetching live database/pages, fall back to cache when offline
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cache successful responses for static assets
        if (response.ok && event.request.url.startsWith(self.location.origin)) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // Fallback to cache if network fails (crucial for mobile drivers with poor signal)
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
        });
      })
  );
});
