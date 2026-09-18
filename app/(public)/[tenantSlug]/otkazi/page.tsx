import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { getSalonSummary } from "@/lib/db/public-cancel";
import { sr } from "@/lib/i18n/sr";
import { LegalLinks, PublicPage, SalonHeader } from "../page";
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

  // Isto kao na strani za zakazivanje: nepostojeći i suspendovan salon ne smeju
  // da se razlikuju za posetioca, pa oba idu na `not-found.tsx` segmenta — ista
  // poruka kao ranije, sada sa statusom 404.
  if (!data) {
    notFound();
  }

  return (
    <PublicPage>
      <SalonHeader
        name={data.name}
        logoUrl={data.logo_url}
        eyebrow={sr.cancel.title}
      />

      <CancelFlow
        slug={data.slug}
        salonName={data.name}
        timeZone={data.timezone}
      />

      <div className="mt-auto flex flex-col border-t border-[#DED5C7] pt-1">
        <p className="text-center text-[12.5px] text-[#554C44]">
          <Link
            href={`/${tenantSlug}`}
            className="inline-block py-3.5 text-[#8C1D3F] underline"
          >
            {sr.cancel.back}
          </Link>
        </p>

        <LegalLinks />
      </div>
    </PublicPage>
  );
}
