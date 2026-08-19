"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { sr } from "@/lib/i18n/sr";

/**
 * Granica greške za sve što se prikaže unutar `layout`-a.
 *
 * Bez nje Next pokaže svoj podrazumevani beli ekran sa engleskim tekstom
 * „Application error", bez puta nazad — što je klijentkinja usred zakazivanja
 * pročitala kao „ovaj salon ne radi".
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // `keepalive` jer se strana ume zatvoriti pre nego što prijava stigne.
    void fetch("/api/greske", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        message: error.message,
        digest: error.digest ?? null,
        path: window.location.pathname,
        stack: error.stack ?? null,
      }),
    }).catch(() => {
      // Prijava greške ne sme da napravi drugu.
    });
  }, [error]);

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-4 text-center">
        <h1 className="text-xl font-semibold tracking-tight">
          {sr.error.title}
        </h1>
        <p className="text-muted-foreground text-sm">{sr.error.body}</p>
        <div className="flex flex-col gap-2">
          <Button type="button" onClick={reset}>
            {sr.error.retry}
          </Button>
          {/* Veza, ne dugme: put nazad mora da postoji i kad `reset` vrati
              istu grešku, jer je ona u samoj strani a ne u prolaznom stanju. */}
          <Link href="/" className={buttonVariants({ variant: "outline" })}>
            {sr.error.home}
          </Link>
        </div>
      </div>
    </main>
  );
}
