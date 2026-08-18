import type { Metadata } from "next";
import Link from "next/link";
import { sr } from "@/lib/i18n/sr";

export const metadata: Metadata = {
  title: `${sr.notFound.title} — ${sr.app.name}`,
};

/**
 * Bez ovoga Next prikazuje svoju stranu na engleskom („This page could not be
 * found."). Nju vidi i vlasnica salona koja otvori `/admin` a nije vlasnik
 * platforme, jer se tamo namerno zove `notFound()` umesto poruke o zabrani.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-xl font-semibold tracking-tight">
        {sr.notFound.title}
      </h1>
      <p className="text-muted-foreground text-sm">{sr.notFound.body}</p>
      <Link
        href="/"
        className="text-brand inline-flex min-h-11 items-center text-sm underline"
      >
        {sr.notFound.home}
      </Link>
    </main>
  );
}
