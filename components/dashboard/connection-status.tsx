"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { sr } from "@/lib/i18n/sr";
import { useOnline } from "@/lib/use-online";

/**
 * Kalendar koji se prikazuje bez veze je stariji od onoga što je u bazi. Ovo to
 * kaže: da je veza nestala, od kad je prikazani raspored, i da novi termini
 * neće stići dok se veza ne vrati. Raspored se ne kešira — servisni radnik
 * namerno ne čuva kalendar, jer star raspored izgleda kao tačan.
 *
 * Kad se veza vrati, podaci se sami osvežavaju. Dugme „Pokušaj ponovo" proverava
 * vezu pravim zahtevom, jer `navigator.onLine` ume da kaže „povezan" na mreži
 * bez interneta; `router.refresh()` bez veze bi odveo na stranu greške
 * pregledača.
 */
export function ConnectionStatus({ updatedAt }: { updatedAt: string }) {
  const online = useOnline();
  const router = useRouter();
  const [stillOffline, setStillOffline] = useState(false);
  const [checking, startChecking] = useTransition();
  const wasOffline = useRef(false);

  useEffect(() => {
    if (!online) {
      wasOffline.current = true;
      return;
    }

    if (wasOffline.current) {
      wasOffline.current = false;
      setStillOffline(false);
      router.refresh();
    }
  }, [online, router]);

  function retry() {
    setStillOffline(false);
    startChecking(async () => {
      try {
        const probe = await fetch("/manifest.webmanifest", {
          cache: "no-store",
        });

        if (!probe.ok) {
          throw new Error("probe failed");
        }

        router.refresh();
      } catch {
        setStillOffline(true);
      }
    });
  }

  if (online) {
    return null;
  }

  return (
    <div
      role="status"
      className="mb-3 space-y-2 rounded-[18px] bg-[#B3261E]/10 p-4"
    >
      <p className="text-sm font-semibold text-[#B3261E]">
        {sr.offline.dashboardTitle}
      </p>
      <p className="text-xs leading-relaxed text-[#554C44]">
        {sr.offline.dashboardBody.replace("{vreme}", updatedAt)}
      </p>
      <Button
        type="button"
        variant="outline"
        className="h-11 w-full"
        onClick={retry}
        disabled={checking}
      >
        {checking ? sr.offline.checking : sr.offline.retry}
      </Button>
      {stillOffline ? (
        <p role="alert" className="text-xs text-[#B3261E]">
          {sr.offline.stillOffline}
        </p>
      ) : null}
    </div>
  );
}
