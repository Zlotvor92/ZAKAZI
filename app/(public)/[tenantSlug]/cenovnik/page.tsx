import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { getSalonSummary } from "@/lib/db/public-cancel";
import { priceListFor } from "@/lib/domain/price-list";
import { sr } from "@/lib/i18n/sr";
import { LegalLinks, PublicPage, SalonHeader } from "../page";

type PageProps = { params: Promise<{ tenantSlug: string }> };

const salonSummary = cache(getSalonSummary);

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { tenantSlug } = await params;
  const images = priceListFor(tenantSlug);
  const salon = images ? await salonSummary(tenantSlug) : null;

  if (!images || !salon) {
    return { title: sr.booking.unavailableTitle };
  }

  const title = sr.booking.priceList.title(salon.name);

  return {
    title,
    alternates: { canonical: `/${tenantSlug}/cenovnik` },
    openGraph: {
      type: "website",
      title,
      locale: "sr_RS",
      images: [images[0]!.src],
    },
  };
}

export default async function PriceListPage({ params }: PageProps) {
  const { tenantSlug } = await params;
  const images = priceListFor(tenantSlug);
  const salon = images ? await salonSummary(tenantSlug) : null;

  if (!images || !salon) {
    notFound();
  }

  return (
    <PublicPage>
      <SalonHeader
        name={salon.name}
        logoUrl={salon.logo_url}
        eyebrow={sr.booking.priceList.eyebrow}
      />

      <div className="-mx-6 flex flex-col gap-3">
        {images.map((image, index) => (
          <Image
            key={image.src}
            src={image.src}
            alt={image.alt}
            width={1080}
            height={1920}
            sizes="(max-width: 448px) 100vw, 448px"
            priority={index === 0}
            className="h-auto w-full"
          />
        ))}
      </div>

      <Link
        href={`/${tenantSlug}`}
        className="flex min-h-14 items-center justify-center gap-2 bg-[#8C1D3F] px-4 text-sm font-bold tracking-[0.12em] text-white uppercase transition-transform duration-150 active:scale-[0.985] motion-reduce:transition-none motion-reduce:active:scale-100"
      >
        <ChevronLeft aria-hidden="true" className="size-4" />
        {sr.booking.priceList.back}
      </Link>

      <div className="mt-auto">
        <LegalLinks />
      </div>
    </PublicPage>
  );
}
