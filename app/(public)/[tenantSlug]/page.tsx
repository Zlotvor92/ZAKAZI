import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { display } from "@/app/fonts";
import { getPublicBookingData } from "@/lib/db/public-booking";
import { getSalonSummary } from "@/lib/db/public-cancel";
import { sr } from "@/lib/i18n/sr";
import { BookingFlow } from "./booking-flow";

type PageProps = { params: Promise<{ tenantSlug: string }> };

/** Naslov i sama stranica traže isto; bez ovoga bi to bila dva ista upita. */
const bookingData = cache(getPublicBookingData);

/** Traži se samo kad je zakazivanje zatvoreno, da se salon razluči od slova. */
const salonSummary = cache(getSalonSummary);

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { tenantSlug } = await params;
  const data = await bookingData(tenantSlug);

  return { title: data ? data.tenant.name : sr.booking.unavailableTitle };
}

/**
 * Traka pretraživača nosi boju papira, istu za sve salone. Ranije je uzimala
 * boju koju salon izabere; ta mogućnost više ne postoji, pa ni upit za nju.
 */
export const viewport: Viewport = { themeColor: "#FBF7F0" };

/**
 * Papir na kom stoji sve što klijentkinja vidi.
 *
 * Boje su upisane kao heksadecimalne vrednosti, ne kao tokeni teme, iz istog
 * razloga kao na početnoj strani: stranica izgleda isto i u tamnom režimu.
 * Klijentkinja koja otvori link salona ne sme da dobije drugačiju stranu zato
 * što je njen telefon podešen na tamno.
 */
export function PublicPage({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-[#FBF7F0] text-[#211D1A]">
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-6 pb-8">
        {children}
      </main>
    </div>
  );
}

/**
 * Logo salona, nadnaslov i ime. Jedino mesto na strani gde salon ostavlja
 * svoj trag — sve ostalo izgleda isto kod svih.
 */
export function SalonHeader({
  name,
  logoUrl,
  eyebrow,
}: {
  name: string;
  logoUrl?: string | null;
  eyebrow: string;
}) {
  return (
    <header className="flex flex-col gap-3 pt-7">
      {logoUrl ? (
        // Obična slika, ne `next/image`: logo je jedna mala datoteka fiksne
        // veličine, pa optimizacija ne bi uštedela ništa a tražila bi
        // podešavanje spoljnog domena.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoUrl}
          alt={name}
          width={144}
          height={144}
          className="size-[72px] rounded-full border-2 border-[#8C1D3F] object-cover"
        />
      ) : (
        /* Bez logoa: prsten oko slova je isti potez kao prsten oko logoa. */
        <span
          className={`${display.className} flex size-[72px] items-center justify-center rounded-full border-2 border-[#8C1D3F] text-[30px] text-[#8C1D3F]`}
        >
          {name.trim().slice(0, 1).toUpperCase()}
        </span>
      )}

      <span className="text-[11px] font-bold tracking-[0.2em] text-[#8C1D3F] uppercase">
        {eyebrow}
      </span>

      <h1
        className={`${display.className} text-[40px] leading-[1.04] tracking-[-0.02em] text-balance`}
      >
        {name}
      </h1>

      <span className="h-0.5 w-14 bg-[#211D1A]" />
    </header>
  );
}

/** Podnožje koje nosi svaka javna strana. */
export function LegalLinks() {
  return (
    <p className="text-center text-xs text-[#7A6F63]">
      <Link href="/uslovi-koriscenja" className="inline-block py-3.5 underline">
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
  );
}

export function Notice({
  title,
  message,
  children,
}: {
  title: string;
  message: string;
  children?: React.ReactNode;
}) {
  return (
    <PublicPage>
      <h1 className={`${display.className} pt-10 text-[32px] leading-tight`}>
        {title}
      </h1>
      <p className="text-sm leading-relaxed text-[#554C44]">{message}</p>
      {children}
      <div className="mt-auto">
        <LegalLinks />
      </div>
    </PublicPage>
  );
}

export default async function PublicBookingPage({ params }: PageProps) {
  const { tenantSlug } = await params;
  const data = await bookingData(tenantSlug);

  // Zakazivanje je zatvoreno, ali salon postoji i nije pauziran — ugašen je
  // prekidač ili je istekla pretplata. Otkazivanje u tom slučaju namerno
  // nastavlja da radi, pa ovde mora da stoji i put do njega: klijentkinja koja
  // je sprečena dolazi na ovaj link, ne na `/otkazi` koji nikad nije videla.
  //
  // Nepoznat i pauziran salon i dalje idu na `not-found.tsx` ovog segmenta, sa
  // statusom 404 — tamo nema šta da se otkaže.
  if (!data) {
    const salon = await salonSummary(tenantSlug);

    if (!salon) {
      notFound();
    }

    return (
      <Notice title={salon.name} message={sr.booking.closed}>
        <p className="text-sm text-[#554C44]">
          {sr.booking.haveAppointment}{" "}
          <Link
            href={`/${tenantSlug}/otkazi`}
            className="inline-block py-3.5 text-[#8C1D3F] underline"
          >
            {sr.booking.manageLink}
          </Link>
        </p>
      </Notice>
    );
  }

  if (data.services.length === 0) {
    return (
      <Notice title={data.tenant.name} message={sr.booking.noServices} />
    );
  }

  return (
    <PublicPage>
      <SalonHeader
        name={data.tenant.name}
        logoUrl={data.tenant.logo_url}
        eyebrow={sr.booking.eyebrow}
      />

      <BookingFlow data={data} />

      {/* `inline-block` sa uspravnim razmakom: tekst ostaje u rečenici, a
          dodirna zona naraste na 44px. Bez toga je meta visoka koliko i
          slovo. */}
      <div className="mt-auto flex flex-col border-t border-[#DED5C7] pt-1">
        <p className="text-center text-[12.5px] text-[#554C44]">
          {sr.booking.haveAppointment}{" "}
          <Link
            href={`/${tenantSlug}/otkazi`}
            className="inline-block py-3.5 text-[#8C1D3F] underline"
          >
            {sr.booking.manageLink}
          </Link>
        </p>

        <LegalLinks />
      </div>
    </PublicPage>
  );
}
