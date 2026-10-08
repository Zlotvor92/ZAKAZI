import { CalendarSearch, ChevronRight } from "lucide-react";
import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { display } from "@/app/fonts";
import { JsonLd } from "@/components/json-ld";
import { getPublicBookingData } from "@/lib/db/public-booking";
import { getSalonSummary } from "@/lib/db/public-cancel";
import { salonDescription, salonJsonLd } from "@/lib/domain/seo";
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

  if (!data) {
    return { title: sr.booking.unavailableTitle };
  }

  const description = salonDescription(
    data.tenant.name,
    data.services.map((service) => service.name),
  );

  // Naslov ostaje golo ime salona: iz njega klijentkina prečica na početnom
  // ekranu dobija ime, pa ključne reči idu u opis i u sadržaj strane.
  return {
    title: data.tenant.name,
    description,
    alternates: { canonical: `/${tenantSlug}` },
    openGraph: {
      type: "website",
      title: data.tenant.name,
      description,
      locale: "sr_RS",
      ...(data.tenant.logo_url ? { images: [data.tenant.logo_url] } : {}),
    },
  };
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
  // `overflow-x-clip`: puls oko dugmeta „Dodaj u kalendar" se širi preko ivica
  // ekrana, a mobilni pregledač zbog toga proširi prozor stranice na 558 px,
  // pa se stranica pomera u stranu i ne može da se skroluje do kraja.
  return (
    <div className="min-h-dvh overflow-x-clip bg-[#FBF7F0] text-[#211D1A]">
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

/**
 * Ulaz za klijentkinju koja već ima termin. Stoji odmah ispod zaglavlja, ne u
 * podnožju: ko dođe da vidi ili otkaže termin ne sme da pretražuje celu stranu
 * za sitan link. Termin se otvara brojem telefona i dokazom da je zakazan sa
 * ovog pregledača (ili linkom koji je sačuvan); vidi `lib/domain/manage-proof.ts`.
 */
export function FindAppointmentLink({ slug }: { slug: string }) {
  return (
    <Link
      href={`/${slug}/otkazi`}
      className="flex min-h-14 items-center gap-3.5 border border-[#211D1A] px-4 py-3 transition-[transform,background-color] duration-150 active:scale-[0.985] active:bg-[#F2EADC] motion-reduce:transition-none motion-reduce:active:scale-100"
    >
      <CalendarSearch
        aria-hidden="true"
        className="size-5 shrink-0 text-[#8C1D3F]"
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[11px] font-bold tracking-[0.16em] uppercase">
          {sr.booking.manageLink}
        </span>
        <span className="text-xs leading-snug text-[#554C44]">
          {sr.booking.manageHint}
        </span>
      </span>
      <ChevronRight
        aria-hidden="true"
        className="size-4 shrink-0 text-[#6B6055]"
      />
    </Link>
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
        <FindAppointmentLink slug={tenantSlug} />
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
      <JsonLd
        data={salonJsonLd({
          name: data.tenant.name,
          slug: data.tenant.slug,
          logoUrl: data.tenant.logo_url,
          description: salonDescription(
            data.tenant.name,
            data.services.map((service) => service.name),
          ),
          services: data.services.map((service) => ({
            name: service.name,
            description: service.description,
            priceRsd: service.price_rsd,
          })),
        })}
      />
      <SalonHeader
        name={data.tenant.name}
        logoUrl={data.tenant.logo_url}
        eyebrow={sr.booking.eyebrow}
      />

      <FindAppointmentLink slug={tenantSlug} />

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
