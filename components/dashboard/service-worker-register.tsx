"use client";

import { reportPushInteraction } from "@/lib/push-diagnostics-client";
import { useEffect } from "react";
import { restoreNotifications } from "@/app/(dashboard)/dashboard/podesavanja/actions";
import { toInput } from "@/components/dashboard/push-toggle";

/**
 * Servisni radnik daje stranu „nema veze" umesto prazne strane pregledača, pa
 * mora da postoji i kod onih koji obaveštenja nikad nisu uključili. Ništa ne
 * kešira (vidi `public/sw.js`), pa registracija ne menja šta se prikazuje.
 *
 * Drugi posao: ako je pregledač već pretplaćen, a server pretplatu nema
 * (odjava je briše), upisuje se ponovo — vidi `restoreNotifications`.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    const flush=() => {
      navigator.serviceWorker.controller?.postMessage({type:"flush-push-receipts"});
    };
    const onVisible=() => {if(document.visibilityState==="visible")flush();};
    window.addEventListener("online",flush);
    document.addEventListener("visibilitychange",onVisible);
    navigator.serviceWorker.addEventListener("controllerchange",flush);
    void (async () => {
      try {
        await navigator.serviceWorker.register("/sw.js");
        reportPushInteraction("worker_registered");
        flush();

        if (!("Notification" in window) || Notification.permission !== "granted") {
          return;
        }

        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        const input = subscription ? toInput(subscription) : null;

        if (input) {
          await restoreNotifications(input);
        }
      } catch {
        // Bez radnika ostaje obična strana pregledača; ništa drugo ne zavisi od njega.
      }
    })();
    return () => {
      window.removeEventListener("online",flush);
      document.removeEventListener("visibilitychange",onVisible);
      navigator.serviceWorker.removeEventListener("controllerchange",flush);
    };
  }, []);

  return null;
}
