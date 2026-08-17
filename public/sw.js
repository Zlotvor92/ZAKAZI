// Servis radnik postoji samo zbog obaveštenja. Ne kešira ništa — kalendar koji
// pokaže jučerašnje stanje je gori od kalendara koji se sporije otvori.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }

  const title = data.title || "Novo zakazivanje";
  const url = data.url || "/dashboard";

  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      // Vibracija je jedini deo koji radi i kad je telefon u džepu.
      vibrate: [80, 40, 80],
      // Isti termin ne sme da napravi dva obaveštenja jedno preko drugog.
      tag: data.tag || url,
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/dashboard";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windows) => {
        // Ako je aplikacija već otvorena, koristi se ta kartica umesto nove.
        for (const client of windows) {
          if (client.url.includes(url) && "focus" in client) {
            return client.focus();
          }
        }
        return self.clients.openWindow(url);
      }),
  );
});
