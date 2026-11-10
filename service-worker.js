// Service Worker for 部品在庫管理システム（共有サーバー版）
// 方針: 常にサーバーの最新ファイルを使う（ネットワーク優先）。
//       サーバーに繋がらない時だけ、前回のファイルで画面を表示する。
//       データ（/api/）はキャッシュしない。
const CACHE_NAME = 'inventory-management-v4';
const urlsToCache = [
    './',
    './index.html',
    './css/styles.css',
    './js/app.js',
    './js/database.js',
    './js/models.js',
    './js/ui-manager.js',
    './js/inventory-logic.js',
    './js/cost-calculator.js',
    './js/excel-manager.js',
    './js/search-manager.js',
    './js/order-manager.js',
    './js/config.js',
    './js/sharepoint-transport.js',
    './js/vendor/msal-browser.min.js'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(urlsToCache))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    // 古いキャッシュ（v1 など）を削除
    event.waitUntil(
        caches.keys().then((names) => Promise.all(
            names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
        )).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    const url = new URL(req.url);
    // データ通信・他サイト（SheetJS の CDN など）は素通し
    if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/api/') || url.pathname.endsWith('/redirect.html')) {
        return;
    }
    event.respondWith(
        fetch(req)
            .then((res) => {
                if (res.ok) {
                    const copy = res.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
                }
                return res;
            })
            .catch(() => caches.match(req))
    );
});
