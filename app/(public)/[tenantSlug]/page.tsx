import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { getPublicBookingData } from "@/lib/db/public-booking";
import { brandVariables } from "@/lib/domain/brand";
import { sr } from "@/lib/i18n/sr";
import { BookingFlow } from "./booking-flow";

type PageProps = { params: Promise<{ tenantSlug: string }> };

/** Naslov i sama stranica traže isto; bez ovoga bi to bila dva ista upita. */
const bookingData = cache(getPublicBookingData);

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { tenantSlug } = await params;
  const data = await bookingData(tenantSlug);

  return { title: data ? data.tenant.name : sr.booking.unavailableTitle };
}

/**
 * Traka pretraživača na telefonu uzme boju salona, pa stranica ne izgleda kao
 * tuđa aplikacija sa njihovim imenom u njoj.
 */
export async function generateViewport({
  params,
}: PageProps): Promise<Viewport> {
  const { tenantSlug } = await params;
  const data = await bookingData(tenantSlug);

  return { themeColor: data?.tenant.brand_background ?? undefined };
}

/**
 * Boje salona se ubacuju kao `:root` pravilo, ne kao stil na elementu, jer
 * pozadinu strane crta `body` — stil na `<main>` bi ostavio belo oko nje.
 * Vrednosti prolaze kroz `brandVariables`, koja pušta samo heks boje.
 */
export function Brand({
  tenant,
}: {
  tenant: {
    brand_background: string | null;
    brand_primary: string | null;
    brand_accent: string | null;
  };
}) {
  const variables = brandVariables({
    background: tenant.brand_background,
    primary: tenant.brand_primary,
    accent: tenant.brand_accent,
  });

  if (variables === null) {
    return null;
  }

  return (
    <style dangerouslySetInnerHTML={{ __html: `:root{${variables}}` }} />
  );
}

export function Notice({ title, message }: { title: string; message: string }) {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-md p-4">
      <h1 className="pt-8 text-lg font-semibold">{title}</h1>
      <p className="text-muted-foreground pt-2 text-sm">{message}</p>
    </main>
  );
}

export default async function PublicBookingPage({ params }: PageProps) {
  const { tenantSlug } = await params;
  const data = await bookingData(tenantSlug);

  // Nepoznat salon, ugašeno zakazivanje i suspendovan salon se i dalje namerno
  // ne razlikuju: iz javne stranice se ne saznaje koji slugovi postoje. Sva tri
  // vode na `not-found.tsx` ovog segmenta, koji nosi istu poruku kao ranije —
  // razlika je samo u statusu 404, da pogrešno prepisana adresa prestane da se
  // predstavlja kao postojeća strana.
  if (!data) {
    notFound();
  }

  if (data.services.length === 0) {
    return (
      <>
        <Brand tenant={data.tenant} />
        <Notice title={data.tenant.name} message={sr.booking.noServices} />
      </>
    );
  }

  return (
    <>
      <Brand tenant={data.tenant} />
      <main className="mx-auto min-h-dvh w-full max-w-md px-4 pb-10">
        <header className="flex flex-col items-center gap-3 pt-8 pb-2 text-center">
          {data.tenant.logo_url ? (
            // Obična slika, ne `next/image`: logo je jedna mala datoteka fiksne
            // veličine, pa optimizacija ne bi uštedela ništa a tražila bi
            // podešavanje spoljnog domena.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={data.tenant.logo_url}
              alt={data.tenant.name}
              width={112}
              height={112}
              className="border-primary size-28 rounded-full border-2 object-cover"
            />
          ) : (
            /* Bez logoa: prsten oko slova je isti potez kao prsten oko logoa. */
            <span className="border-primary text-brand flex size-16 items-center justify-center rounded-full border-2 text-2xl font-bold">
              {data.tenant.name.trim().slice(0, 1).toUpperCase()}
            </span>
          )}
          <h1 className="text-2xl font-bold tracking-tight text-balance">
            {data.tenant.name}
          </h1>
        </header>

        <BookingFlow data={data} />

        {/* `inline-block` sa uspravnim razmakom: tekst ostaje u rečenici, a
            dodirna zona naraste na 44px. Bez toga je meta visoka koliko i
            slovo. */}
        <p className="text-muted-foreground pt-2 text-center text-xs">
          {sr.booking.haveAppointment}{" "}
          <Link
            href={`/${tenantSlug}/otkazi`}
            className="text-brand inline-block py-3.5 underline"
          >
            {sr.booking.manageLink}
          </Link>
        </p>

        <p className="text-muted-foreground text-center text-xs">
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
    </>
  );
}
