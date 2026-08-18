import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import { getSalonSummary } from "@/lib/db/public-cancel";
import { sr } from "@/lib/i18n/sr";
import { Brand } from "../page";
import { CancelFlow } from "./cancel-flow";

type PageProps = { params: Promise<{ tenantSlug: string }> };

const salonSummary = cache(getSalonSummary);

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { tenantSlug } = await params;
  const data = await salonSummary(tenantSlug);

  return {
    title: data
      ? `${sr.cancel.title} — ${data.name}`
      : sr.booking.unavailableTitle,
  };
}

export default async function CancelPage({ params }: PageProps) {
  const { tenantSlug } = await params;
  const data = await salonSummary(tenantSlug);

  // Isti nedostatak razlike kao na strani za zakazivanje: nepostojeći salon i
  // suspendovan salon ne smeju da se razlikuju za posetioca.
  if (!data) {
    return (
      <main className="mx-auto min-h-dvh w-full max-w-md p-4">
        <h1 className="pt-8 text-lg font-semibold">{sr.app.name}</h1>
        <p className="text-muted-foreground pt-2 text-sm">
          {sr.booking.closed}
        </p>
      </main>
    );
  }

  return (
    <>
      <Brand tenant={data} />
      <main className="mx-auto min-h-dvh w-full max-w-md px-4 pb-10">
        <header className="flex flex-col items-center gap-3 pt-8 pb-2 text-center">
          {data.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={data.logo_url}
              alt={data.name}
              width={112}
              height={112}
              className="border-primary size-28 rounded-full border-2 object-cover"
            />
          ) : (
            <span className="border-primary text-brand flex size-16 items-center justify-center rounded-full border-2 text-2xl font-bold">
              {data.name.trim().slice(0, 1).toUpperCase()}
            </span>
          )}
          <h1 className="text-2xl font-bold tracking-tight text-balance">
            {data.name}
          </h1>
        </header>

        <h2 className="pt-2 pb-1 text-base font-semibold">{sr.cancel.title}</h2>

        <CancelFlow slug={data.slug} timeZone={data.timezone} />

        <p className="text-muted-foreground pt-4 text-center text-xs">
          <Link href={`/${tenantSlug}`} className="text-brand underline">
            {sr.cancel.back}
          </Link>
        </p>
      </main>
    </>
  );
}
