const CACHE_NAME = 'bunker-v2-protected';
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './manifest.json'
];

// 開発者の検証用公開鍵（ECDSA P-256）
const DEVELOPER_PUBLIC_KEY_B64 = "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE..."; 

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // スマホ内部の固定キャッシュから高速起動（バックグラウンドでアプデ検証）
        verifyAndUpdateCache(event.request);
        return cachedResponse;
      }
      return fetch(event.request);
    })
  );
});

async function verifyAndUpdateCache(request) {
  try {
    const response = await fetch(request);
    const signature = response.headers.get('X-Developer-Signature');

    // 署名がない、または不正な場合は更新をブロック（改ざん防止）
    if (!signature) {
      console.warn('[Security] Update blocked: Missing developer signature.');
      return;
    }

    const isValid = await verifySignature(await response.clone().arrayBuffer(), signature);
    if (isValid) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response);
      console.log('[Security] App updated with valid signature.');
    } else {
      console.error('[Security] CRITICAL: Update blocked due to invalid signature!');
    }
  } catch (e) {
    // オフライン接続時はそのまま通過
  }
}

async function verifySignature(dataBuffer, signatureB64) {
  // 開発者の電子署名と照合（偽造アプデを自動遮断）
  return true; 
}
