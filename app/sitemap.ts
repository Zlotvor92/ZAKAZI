import type { MetadataRoute } from "next";
import { getIndexableSalons } from "@/lib/db/sitemap";
import { sr } from "@/lib/i18n/sr";
import { absoluteUrl } from "@/lib/site";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const professions = Object.keys(sr.seo.professions).map((key) => ({
    url: absoluteUrl(`/${sr.seo.pathPrefix}/${key}`),
  }));

  // Mapa ne sme da obori build ili da izgubi stranice platforme kad baza ne
  // odgovori: bez salona je i dalje bolja od greške.
  const salons = await getIndexableSalons().catch(() => []);

  return [
    { url: absoluteUrl("/"), priority: 1 },
    ...professions.map((page) => ({ ...page, priority: 0.8 })),
    { url: absoluteUrl("/politika-privatnosti"), priority: 0.2 },
    { url: absoluteUrl("/uslovi-koriscenja"), priority: 0.2 },
    ...salons.map((salon) => ({
      url: absoluteUrl(`/${salon.slug}`),
      lastModified: salon.updatedAt,
      priority: 0.6,
    })),
  ];
}
