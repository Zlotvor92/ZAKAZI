// Servis radnik postoji zbog obaveštenja. Ne kešira ništa — kalendar koji
// pokaže jučerašnje stanje je gori od kalendara koji se sporije otvori.
//
// Jedino što radi mimo obaveštenja: kad se stranica otvori bez veze, umesto
// prazne strane pregledača pokazuje kratko objašnjenje. Podaci se ne čuvaju, pa
// ni ova strana ne može da pokaže star raspored.

const OFFLINE_PAGE = `<!doctype html>
<html lang="sr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#FBF7F0">
<title>Nema internet veze</title>
<style>
  body { margin: 0; min-height: 100dvh; display: grid; place-items: center; background: #FBF7F0; color: #211D1A; font-family: system-ui, sans-serif; }
  main { max-width: 22rem; padding: 1.5rem; }
  h1 { font-size: 1.5rem; margin: 0 0 .75rem; }
  p { line-height: 1.5; color: #554C44; margin: 0 0 1.25rem; }
  button { width: 100%; min-height: 3rem; border: 0; background: #211D1A; color: #FBF7F0; font-size: 1rem; }
</style>
</head>
<body>
<main>
<h1>Nema internet veze</h1>
<p>Raspored se ne prikazuje bez veze, da ne bi bio star. Zakazivanje i otkazivanje nisu mogući dok se veza ne vrati.</p>
<button type="button" onclick="location.reload()">Pokušaj ponovo</button>
</main>
</body>
</html>`;

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") {
    return;
  }

  event.respondWith(
    fetch(event.request).catch(
      () =>
        new Response(OFFLINE_PAGE, {
          status: 503,
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
          },
        }),
    ),
  );
});

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(Promise.allSettled([self.clients.claim(), flushPushReceipts()])),
);


const PUSH_DIAGNOSTICS_VERSION = "2026-10-20.1";
let receiptFlush = null;
function receiptDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { resolve(null); return; }
    const request = indexedDB.open("doterajme-push-diagnostics", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("receipts", { keyPath: "eventId" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Receipt database blocked"));
  });
}
async function receiptStore(mode, operation) {
  const db = await receiptDb();
  if (!db) return null;
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("receipts", mode);
      const request = operation(tx.objectStore("receipts"));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
function validTracking(tracking) {
  return tracking && /^[0-9a-f-]{36}$/i.test(tracking.attemptId || "") &&
    /^[A-Za-z0-9_-]{43}$/.test(tracking.token || "");
}
function receiptDetails(extra = {}) {
  return {
    workerVersion: PUSH_DIAGNOSTICS_VERSION,
    permission: typeof Notification !== "undefined" ? Notification.permission : "unknown",
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 512) : "unknown",
    ...(typeof navigator !== "undefined" ? { online: navigator.onLine } : {}),
    ...extra,
  };
}
async function postReceipt(receipt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch("/api/push/receipt", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(receipt), signal: controller.signal,
    });
    // Invalid/revoked capabilities cannot improve on retry; leave transient failures queued.
    return response.ok || [400,403,404,413].includes(response.status);
  } finally { clearTimeout(timer); }
}
function flushPushReceipts() {
  if (receiptFlush) return receiptFlush;
  receiptFlush = (async () => {
    const rows = await receiptStore("readonly", store => store.getAll());
    if (!rows) return;
    for (const row of rows.slice(0, 64)) {
      try {
        if (await postReceipt(row)) await receiptStore("readwrite", store => store.delete(row.eventId));
      } catch { break; }
    }
  })().catch(() => {}).finally(() => { receiptFlush = null; });
  return receiptFlush;
}
async function reportPushEvent(tracking, kind, extra = {}, at = new Date().toISOString()) {
  if (!validTracking(tracking)) return;
  const receipt = {
    ...tracking, eventId: crypto.randomUUID(), kind, clientAt: at,
    details: receiptDetails(extra),
  };
  let stored = false;
  try {
    await receiptStore("readwrite", store => store.put(receipt));
    stored = typeof indexedDB !== "undefined";
  } catch { /* Storage can be disabled; still attempt the receipt immediately. */ }
  if (stored) {
    await flushPushReceipts();
    await flushPushReceipts();
    try { await self.registration.sync?.register("push-receipts"); } catch { /* Not available on every browser. */ }
  } else {
    try { await postReceipt(receipt); } catch { /* Never block the notification. */ }
  }
}
self.addEventListener("message", (event) => {
  if (event.data?.type === "flush-push-receipts") event.waitUntil(flushPushReceipts());
});
self.addEventListener("sync", (event) => {
  if (event.tag === "push-receipts") event.waitUntil(flushPushReceipts());
});
self.addEventListener("push", (event) => {
  const receivedAt = new Date().toISOString();
  let data = {};
  let malformed = false;
  try { data = event.data ? event.data.json() : {}; }
  catch { malformed = true; }
  if (!data || typeof data !== "object") { data = {}; malformed = true; }
  const title = data.title || "Novo zakazivanje";
  const url = data.url || "/dashboard";
  const received = reportPushEvent(data.tracking, "received", {}, receivedAt);
  // Start display immediately. Neither local storage nor network receipts gate it.
  const display = (async () => {
    try {
      await self.registration.showNotification(title, {
        body: data.body || "", icon: "/icon-192.png", badge: "/badge-96.png",
        vibrate: [80, 40, 80], tag: data.tag || url,
        data: { url, tracking: data.tracking },
      });
      await reportPushEvent(data.tracking, "show_resolved");
    } catch (error) {
      await reportPushEvent(data.tracking, "show_failed", {
        errorName: String(error?.name || "Error").slice(0,80),
      });
    }
  })();
  event.waitUntil(Promise.allSettled([
    received, display, notifyOpenWindows({ type: "refresh" }), flushPushReceipts(),
    ...(malformed ? [reportPushEvent(data.tracking, "payload_invalid")] : []),
  ]));
});
self.addEventListener("notificationclick", (event) => {
  const tracking = event.notification.data?.tracking;
  const clicked = reportPushEvent(tracking, "clicked", { action: String(event.action || "").slice(0,80) });
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/dashboard", self.location.origin);
  // A notification must never navigate outside this app.
  if (target.origin !== self.location.origin) target.href = self.location.origin + "/dashboard";
  const opening = openTarget(target.href).then(
    () => reportPushEvent(tracking,"click_opened"),
    (error) => reportPushEvent(tracking,"click_failed",{errorName:String(error?.name || "Error").slice(0,80)}),
  );
  event.waitUntil(Promise.allSettled([clicked, opening]));
});
self.addEventListener("notificationclose", (event) => {
  // Browser-reported dismissal only; programmatic close is not evidence of dismissal.
  event.waitUntil(reportPushEvent(event.notification.data?.tracking, "closed"));
});

function dashboardWindows() {
  return self.clients
    .matchAll({ type: "window", includeUncontrolled: true })
    .then((windows) =>
      windows.filter((client) =>
        new URL(client.url).pathname.startsWith("/dashboard"),
      ),
    );
}

function notifyOpenWindows(message) {
  return dashboardWindows().then((windows) => {
    for (const client of windows) {
      client.postMessage(message);
    }
  });
}

// Ako je kalendar već otvoren, koristi se ta kartica, ali se ona vodi na
// adresu iz obaveštenja: samo `focus()` je ostavljao stari dan i stari
// raspored, a kod dva salona i pogrešan salon. `navigate` učitava stranicu iznova.
function openTarget(target) {
  return dashboardWindows().then(async (windows) => {
    // Vidljiva kartica ima prednost: ostale su u pozadini i niko ih ne gleda.
    const open =
      windows.find((client) => client.visibilityState === "visible") ??
      windows[0];

    if (open) {
      try {
        const focused = await open.focus();
        if (focused && "navigate" in focused) {
          await focused.navigate(target);
          return;
        }
      } catch {
        // Neki pregledači ne dozvoljavaju `navigate`; otvara se nova kartica.
      }
    }

    await self.clients.openWindow(target);
  });
}
