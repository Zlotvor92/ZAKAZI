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
    Promise.all([
      self.registration.showNotification(title, {
        body: data.body || "",
        icon: "/icon-192.png",
        // `badge` se ne crta kao slika: sistem uzme samo alfa kanal i njime
        // maskira jednu boju. `icon-192.png` je neprozirna, bez alfe, pa je od
        // nje ispadao pun beli kvadrat umesto znaka. Ovde stoji silueta na
        // providnoj pozadini, koja je jedino što tu i može da se prikaže.
        badge: "/badge-96.png",
        // Vibracija je jedini deo koji radi i kad je telefon u džepu.
        vibrate: [80, 40, 80],
        // Oznaka dolazi iz poruke i nosi i šta se desilo i koji je termin.
        // Adresa kao rezervni izbor je ista za ceo dan, pa bi otkazivanje tiho
        // zamenilo zakazivanje umesto da stigne kao novo obaveštenje.
        tag: data.tag || url,
        data: { url },
      }),
      // Kalendar koji je već otvoren ne zna da se nešto promenilo. Poruka ne
      // nosi podatke, samo kaže stranici da ih ponovo pročita sa servera.
      notifyOpenWindows({ type: "refresh" }),
    ]),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(
    event.notification.data?.url || "/dashboard",
    self.location.origin,
  ).href;

  event.waitUntil(openTarget(target));
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
