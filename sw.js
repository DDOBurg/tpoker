/* TPoker Service Worker v2：预缓存（逐资源容错）+ 导航网络优先 + 静态资源缓存优先。
 * ASSETS 段由 tools/build_sw.py 生成，勿手改；发版用 tools/build_sw.py --bump。
 */
const VERSION = 'v2.0.0';
const CACHE = 'tpoker-' + VERSION;

/* ASSETS-BEGIN（tools/build_sw.py 生成） */
const ASSETS = [
  './',
  './index.html',
  './css/app.css',
  './js/logic.js',
  './js/store.js',
  './js/ranges.js',
  './js/app.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './data/p1-u01.json',
  './data/p1-u02.json',
  './data/p1-u03.json',
  './data/p1-u04.json',
  './data/p1-u05.json',
  './data/p1-u06.json',
  './data/p1-u07.json',
  './data/p1-u08.json',
  './data/p1-u09.json',
  './data/p1-u10.json',
  './data/p1-u11.json',
  './data/p1-u12.json',
  './data/p1-u13.json',
  './data/p1-u14.json',
  './data/p1-u15.json',
  './data/p1-u16.json',
  './data/units_index.json',
];
/* ASSETS-END */

const NAV_FALLBACK = './index.html';

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      /* 逐资源缓存：单个失败只告警不阻塞安装，缺项由 fetch 运行时补齐 */
      var jobs = ASSETS.map(function (url) {
        return cache.add(url).then(
          function () { return { url: url, ok: true }; },
          function () { return { url: url, ok: false }; }
        );
      });
      return Promise.all(jobs).then(function (results) {
        var failed = results.filter(function (r) { return !r.ok; }).map(function (r) { return r.url; });
        if (failed.length) {
          console.warn('[TPoker SW] 预缓存失败（运行时补齐）: ' + failed.join(', '));
        }
        return self.skipWaiting();
      });
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k.indexOf('tpoker-') === 0 && k !== CACHE) { return caches['delete'](k); }
        return null;
      }));
    }).then(function () {
      return self.clients.matchAll({ includeUncontrolled: true });
    }).then(function (clients) {
      clients.forEach(function (c) {
        c.postMessage({ type: 'TP_VERSION', version: VERSION });
      });
    }).then(function () { return self.clients.claim(); })
  );
});

/* 跳过等待：应用内"点击更新"时由页面 postMessage 触发 */
self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'TP_SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') { return; }
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) { return; }

  /* 导航请求：网络优先（在线立刻拿新版），离线兜底缓存，最终回退应用壳 */
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(function (resp) {
        if (resp && resp.ok) {
          var copy = resp.clone();
          caches.open(CACHE).then(function (cache) {
            cache.put(req, copy).then(null, function () {});
          });
        }
        return resp;
      }).then(null, function () {
        return caches.match(req, { ignoreSearch: true }).then(function (hit) {
          return hit || caches.match(NAV_FALLBACK);
        });
      })
    );
    return;
  }

  /* 静态资源与数据：缓存优先，未命中回源并补缓存 */
  event.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) { return hit; }
      return fetch(req).then(function (resp) {
        if (resp && resp.ok) {
          var copy = resp.clone();
          caches.open(CACHE).then(function (cache) { cache.put(req, copy); });
        }
        return resp;
      }).then(null, function () {
        return new Response('', { status: 503, statusText: 'Offline' });
      });
    })
  );
});
