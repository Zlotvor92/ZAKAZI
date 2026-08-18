import type { Metadata } from "next";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { sr } from "@/lib/i18n/sr";
import { cn } from "@/lib/utils";

/**
 * Naslov je golo ime aplikacije, bez dodatka posle crte.
 *
 * Google pri proveri brenda poredi „App name" iz konzole sa imenom koje nađe
 * na početnoj strani, i taj deo pada kad se stringovi ne poklapaju od reči do
 * reči. Zato ime stoji isto u naslovu, u `application-name` i u Open Graph
 * oznakama — opis ide u `description`, gde mu je i mesto.
 */
export const metadata: Metadata = {
  title: sr.app.name,
  description: sr.home.tagline,
  applicationName: sr.app.name,
  openGraph: {
    type: "website",
    siteName: sr.app.name,
    title: sr.app.name,
    description: sr.home.tagline,
    locale: "sr_RS",
  },
};

/**
 * Jedina strana platforme koju vidi neko ko nije prijavljen i ne dolazi na
 * link salona. Postoji zbog dve stvari: Google traži početnu stranu koja
 * objašnjava šta aplikacija radi pre nego što odobri brendiranje prijave, a
 * `notFound` ionako nudi „nazad na početak" — dotle je to vodilo na prijavu.
 *
 * Prijavljenu vlasnicu odavde skreće middleware, isto kao sa `/prijava`, pa
 * ova strana ostaje statična i ne pita bazu ni za šta.
 */
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-8 px-4 pt-12 pb-8">
      <header className="space-y-3">
        <h1 className="text-3xl font-bold tracking-tight">{sr.app.name}</h1>
        <p className="text-muted-foreground leading-relaxed">
          {sr.home.tagline}
        </p>
      </header>

      <p className="text-sm leading-relaxed">{sr.home.intro}</p>

      <ul className="space-y-5">
        {sr.home.points.map((point) => (
          <li key={point.title} className="space-y-1">
            <h2 className="text-sm font-semibold">{point.title}</h2>
            <p className="text-muted-foreground text-sm leading-relaxed">
              {point.body}
            </p>
          </li>
        ))}
      </ul>

      <p className="text-muted-foreground text-sm leading-relaxed">
        {sr.home.forWho}
      </p>

      <div className="space-y-2">
        <Link href="/prijava" className={cn(buttonVariants(), "w-full")}>
          {sr.home.signIn}
        </Link>
        <p className="text-muted-foreground text-center text-xs">
          {sr.home.signInHint}
        </p>
      </div>

      <p className="text-muted-foreground mt-auto pt-4 text-center text-xs">
        <Link
          href="/uslovi-koriscenja"
          className="inline-block py-3.5 underline"
        >
          {sr.legal.terms}
        </Link>{" "}
        ·{" "}
        <Link
          href="/politika-privatnosti"
          className="inline-block py-3.5 underline"
        >
          {sr.legal.privacy}
        </Link>
      </p>
    </main>
  );
}
