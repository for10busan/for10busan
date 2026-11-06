// 설치(PWA)용 최소 서비스워커: 정적 파일만 캐시, 화면은 항상 네트워크에서
const C = 'for10-v2';
self.addEventListener('install', e => { e.waitUntil(caches.open(C).then(c => c.addAll(['/css/app.css', '/js/app.js', '/img/logo-h-white.png', '/img/icon-192.png']))); self.skipWaiting(); });
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  if (!/^\/(css|js|img)\//.test(u.pathname)) return;
  const put = res => { if (res.ok) { const cp = res.clone(); caches.open(C).then(c => c.put(e.request, cp)); } return res; };
  // 버전(?v=)이 붙은 파일은 캐시 먼저, 버전이 없는 파일(예: /js/xl.js)은 새 파일 먼저 → 고친 내용이 바로 반영
  if (u.search) e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(put)));
  else e.respondWith(fetch(e.request).then(put).catch(() => caches.match(e.request)));
});
