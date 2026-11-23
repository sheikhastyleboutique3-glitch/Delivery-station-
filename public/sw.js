/* رصد — Service Worker بسيط عمداً:
 * - لا يخزّن أي استجابة API (البيانات دائماً من الخادم).
 * - يعرض صفحة offline.html عند فتح صفحة بدون إنترنت.
 * الطلبات المعلقة للسائق تُحفظ في localStorage من داخل الصفحة نفسها وتُرسل عند عودة الاتصال.
 */
const CACHE = 'rasd-shell-v1';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll([OFFLINE_URL, '/icon.svg'])));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || req.mode !== 'navigate') return;
  event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL)));
});
