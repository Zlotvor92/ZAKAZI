"use client";

import { useTransition } from "react";
import { signOut } from "@/app/(dashboard)/dashboard/actions";
import { Button } from "@/components/ui/button";
import { sr } from "@/lib/i18n/sr";

/**
 * Odjava koja kaže serveru koji je ovo telefon, da pretplata na obaveštenja
 * ode zajedno sa sesijom. Pregledač jedini zna svoj `endpoint`.
 */
export function SignOutButton() {
  const [pending, startTransition] = useTransition();

  function onClick() {
    startTransition(async () => {
      let endpoint: string | undefined;

      try {
        const registration = await navigator.serviceWorker?.getRegistration();
        endpoint = (await registration?.pushManager.getSubscription())
          ?.endpoint;
      } catch {
        // Bez pretplate ili bez podrške nema šta da se obriše; odjava ide dalje.
      }

      await signOut(endpoint);
    });
  }

  return (
    <Button
      type="button"
      variant="ghost"
      disabled={pending}
      onClick={onClick}
      className="h-11 rounded-full px-4 text-[11px] font-bold tracking-[0.12em] uppercase hover:bg-white"
    >
      {sr.dashboard.signOut}
    </Button>
  );
}
