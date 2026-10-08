"use client";

import { useEffect } from "react";

/**
 * Servisni radnik daje stranu „nema veze" umesto prazne strane pregledača, pa
 * mora da postoji i kod onih koji obaveštenja nikad nisu uključili. Ništa ne
 * kešira (vidi `public/sw.js`), pa registracija ne menja šta se prikazuje.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js").catch(() => {
        // Bez radnika ostaje obična strana pregledača; ništa drugo ne zavisi od njega.
      });
    }
  }, []);

  return null;
}
