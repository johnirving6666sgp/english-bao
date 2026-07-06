const APP_CACHE = 'english-bao-app-v3';
const AUDIO_CACHE = 'english-bao-audio-v1';
const CORE_ASSETS = ['/', '/index.html', '/manifest.webmanifest'];

const isSameOrigin = (url) => url.origin === self.location.origin;
const isAudioRequest = (url) => url.pathname.startsWith('/audio/');
const isStaticRequest = (url) =>
  url.pathname === '/' ||
  url.pathname === '/index.html' ||
  url.pathname === '/manifest.webmanifest' ||
  url.pathname.startsWith('/assets/');

const rangeResponse = async (request, response) => {
  const range = request.headers.get('range');
  if (!range) return response;

  const buffer = await response.arrayBuffer();
  const size = buffer.byteLength;
  const match = range.match(/bytes=(\d*)-(\d*)/);
  if (!match) return response;

  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Number(match[2]) : size - 1;
  if (Number.isNaN(start) || Number.isNaN(end) || start >= size || end >= size) {
    return new Response(null, {
      status: 416,
      headers: {
        'Content-Range': `bytes */${size}`
      }
    });
  }

  return new Response(buffer.slice(start, end + 1), {
    status: 206,
    statusText: 'Partial Content',
    headers: {
      'Accept-Ranges': 'bytes',
      'Content-Length': String(end - start + 1),
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Type': response.headers.get('Content-Type') || 'audio/mpeg'
    }
  });
};

const cacheFirst = async (request, cacheName) => {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request.url);
  if (cached) return rangeResponse(request, cached);

  const response = await fetch(request);
  if (response.ok) await cache.put(request.url, response.clone());
  return response;
};

const networkFirstPage = async (request) => {
  const cache = await caches.open(APP_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put('/index.html', response.clone());
    return response;
  } catch {
    return (await cache.match('/index.html')) || (await cache.match('/')) || Response.error();
  }
};

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(APP_CACHE).then((cache) => cache.addAll(CORE_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => ![APP_CACHE, AUDIO_CACHE].includes(key)).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (!isSameOrigin(url)) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstPage(request));
    return;
  }

  if (isAudioRequest(url)) {
    event.respondWith(cacheFirst(request, AUDIO_CACHE));
    return;
  }

  if (isStaticRequest(url)) {
    event.respondWith(cacheFirst(request, APP_CACHE));
  }
});
