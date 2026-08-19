"use client";

import { useEffect } from "react";
import { sr } from "@/lib/i18n/sr";
import "./globals.css";

/**
 * Poslednja mreža: greška u samom `layout`-u, iznad koje više ništa ne stoji.
 *
 * Zamenjuje ceo dokument, pa mora da nosi `html` i `body` — i ne sme da se
 * osloni ni na šta iz `layout`-a, jer je upravo on pukao. Zato nema
 * komponenti, samo tekst i veza.
 */
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
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
    <html lang="sr-Latn-RS">
      <body>
        <main className="flex min-h-dvh items-center justify-center p-6">
          <div className="w-full max-w-sm space-y-4 text-center">
            <h1 className="text-xl font-semibold tracking-tight">
              {sr.error.title}
            </h1>
            <p className="text-sm text-neutral-600">{sr.error.body}</p>
            {/* Obična veza, ne `next/link`: ovde je pukao sam omotač
                aplikacije, pa se klijentskom rutiranju ne veruje. Puno
                učitavanje je jedini put koji sigurno radi. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/" className="inline-flex min-h-11 items-center underline">
              {sr.error.home}
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
