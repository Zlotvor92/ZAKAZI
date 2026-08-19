import type { MetadataRoute } from "next";

/**
 * Bez ove rute `/robots.txt` propadne do `[tenantSlug]`, koji ga primi kao ime
 * salona — pa pretraživač ostane bez ijednog pravila i indeksira i prijavu i
 * korake toka za otkazivanje. Metadata rute imaju prednost nad dinamičkim
 * segmentom, isto kao `app/manifest.ts`.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Salonu koristi da ga klijentkinja nađe u pretrazi; sve ostalo je ili
      // tuđi kalendar ili korak u toku koji van svog konteksta ne znači ništa.
      disallow: [
        "/prijava",
        "/dashboard",
        "/admin",
        "/auth",
        "/api",
        "/*/otkazi",
      ],
    },
  };
}
