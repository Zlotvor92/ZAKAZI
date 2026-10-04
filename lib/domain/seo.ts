import { absoluteUrl } from "@/lib/site";

const DESCRIPTION_MAX = 160;

/** Seče na granici reči i dodaje tri tačke, da opis ne bude presečen usred reči. */
export function truncateAtWord(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }

  const cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  const body = lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut;

  return `${body.replace(/[\s,;:.-]+$/, "")}…`;
}

/**
 * Opis stranice salona za rezultate pretrage. Ime i usluge stižu od vlasnice,
 * pa se ništa ne pretpostavlja o njihovoj dužini.
 */
export function salonDescription(
  name: string,
  serviceNames: readonly string[],
): string {
  const base = `${name} — zakažite termin online, bez dopisivanja.`;

  if (serviceNames.length === 0) {
    return truncateAtWord(base, DESCRIPTION_MAX);
  }

  return truncateAtWord(
    `${base} Usluge: ${serviceNames.join(", ")}.`,
    DESCRIPTION_MAX,
  );
}

/**
 * Sadržaj za `<script type="application/ld+json">`. Imena salona unosi
 * korisnik, pa se `<` zamenjuje: bez toga bi ime sa `</script>` zatvorilo
 * oznaku i ostatak izvršilo kao stranicu.
 */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function softwareJsonLd(input: {
  name: string;
  description: string;
  priceRsd: number;
  instagramUrl: string;
}) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SoftwareApplication",
        name: input.name,
        description: input.description,
        url: absoluteUrl("/"),
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        inLanguage: "sr-Latn-RS",
        offers: {
          "@type": "Offer",
          price: String(input.priceRsd),
          priceCurrency: "RSD",
        },
      },
      {
        "@type": "Organization",
        name: input.name,
        url: absoluteUrl("/"),
        sameAs: [input.instagramUrl],
      },
    ],
  };
}

export function salonJsonLd(input: {
  name: string;
  slug: string;
  logoUrl: string | null;
  description: string;
  services: readonly {
    name: string;
    description: string | null;
    priceRsd: number;
  }[];
}) {
  return {
    "@context": "https://schema.org",
    "@type": "HealthAndBeautyBusiness",
    name: input.name,
    url: absoluteUrl(`/${input.slug}`),
    description: input.description,
    ...(input.logoUrl ? { image: input.logoUrl } : {}),
    ...(input.services.length > 0
      ? {
          hasOfferCatalog: {
            "@type": "OfferCatalog",
            name: input.name,
            itemListElement: input.services.map((service) => ({
              "@type": "Offer",
              priceCurrency: "RSD",
              price: String(service.priceRsd),
              itemOffered: {
                "@type": "Service",
                name: service.name,
                ...(service.description
                  ? { description: service.description }
                  : {}),
              },
            })),
          },
        }
      : {}),
  };
}

export function breadcrumbJsonLd(
  items: readonly { name: string; path: string }[],
) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

export function articleJsonLd(input: {
  title: string;
  description: string;
  path: string;
  dateIso: string;
  publisherName: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: input.title,
    description: input.description,
    datePublished: input.dateIso,
    mainEntityOfPage: absoluteUrl(input.path),
    inLanguage: "sr-Latn-RS",
    author: { "@type": "Organization", name: input.publisherName },
    publisher: { "@type": "Organization", name: input.publisherName },
  };
}
