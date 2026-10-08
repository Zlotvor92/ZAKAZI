"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import {
  isRefreshMessage,
  POLL_INTERVAL_MS,
  shouldPoll,
  shouldRefreshAfterAbsence,
} from "@/lib/domain/live-refresh";

/**
 * Drži otvoren kalendar svežim. Server ga ne gura sam od sebe, pa bez ovoga
 * vlasnica koja je ostavila kalendar otvoren vidi stari raspored i posle novog
 * zakazivanja i posle dodira na obaveštenje.
 *
 * Osvežava se u četiri slučaja: kad servisni radnik javi da je stiglo
 * obaveštenje, kad se prozor vrati posle duže pauze, kad se stranica vrati
 * iz keša pregledača (dugme „nazad"), i na svakih nekoliko desetina sekundi
 * dok je kalendar vidljiv — za one koji obaveštenja nisu uključili.
 */
export function LiveRefresh() {
  const router = useRouter();

  useEffect(() => {
    let hiddenAt: number | null =
      document.visibilityState === "hidden" ? Date.now() : null;

    function onVisibility() {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }

      if (hiddenAt !== null && shouldRefreshAfterAbsence(Date.now() - hiddenAt)) {
        router.refresh();
      }
      hiddenAt = null;
    }

    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) {
        router.refresh();
      }
    }

    function onMessage(event: MessageEvent<unknown>) {
      if (isRefreshMessage(event.data)) {
        router.refresh();
      }
    }

    const poll = window.setInterval(() => {
      if (
        shouldPoll({
          visible: document.visibilityState === "visible",
          online: navigator.onLine,
        })
      ) {
        router.refresh();
      }
    }, POLL_INTERVAL_MS);

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onPageShow);
    navigator.serviceWorker?.addEventListener("message", onMessage);

    return () => {
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
      navigator.serviceWorker?.removeEventListener("message", onMessage);
    };
  }, [router]);

  return null;
}
