self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

const OFFLINE = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sin conexión</title><body style="font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;background:#fafaf9;color:#27272a;text-align:center;padding:24px">
<div><h1 style="font-size:20px;margin:0 0 8px">Sin conexión</h1><p style="margin:0 0 16px;color:#71717a">Revisa tu internet y vuelve a intentar.</p>
<button onclick="location.reload()" style="background:#ea580c;color:#fff;border:0;border-radius:10px;padding:12px 20px;font-size:16px">Reintentar</button></div></body></html>`;

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return; // lo demás va directo a la red
  event.respondWith(fetch(event.request).catch(() => new Response(OFFLINE, { headers: { "Content-Type": "text/html; charset=utf-8" } })));
});
