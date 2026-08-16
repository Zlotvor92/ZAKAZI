import type { Metadata } from "next";
import { cache } from "react";
import { getPublicBookingData } from "@/lib/db/public-booking";
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

  return { title: data ? data.tenant.name : sr.booking.notFound };
}

function Notice({ title, message }: { title: string; message: string }) {
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

  // Nepoznat salon i ugašeno zakazivanje se namerno ne razlikuju: iz javne
  // stranice se ne saznaje koji slugovi postoje.
  if (!data) {
    return <Notice title={sr.app.name} message={sr.booking.closed} />;
  }

  if (data.services.length === 0) {
    return (
      <Notice title={data.tenant.name} message={sr.booking.noServices} />
    );
  }

  return (
    <main className="mx-auto min-h-dvh w-full max-w-md p-4">
      <header className="pb-2">
        <h1 className="truncate text-xl font-semibold tracking-tight">
          {data.tenant.name}
        </h1>
      </header>

      <BookingFlow data={data} />
    </main>
  );
}
