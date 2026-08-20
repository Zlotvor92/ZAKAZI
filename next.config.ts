import type { NextConfig } from "next";

/**
 * Zaglavlja koja Vercel sam ne šalje.
 *
 * `Strict-Transport-Security` stiže i bez ovoga, ali bez `includeSubDomains` —
 * pa se ovde dopisuje u punom obliku. `preload` namerno nije uključen: on je
 * jednosmeran, upisuje se u spisak koji nose sami pregledači, i vadi se
 * mesecima. Uključi ga tek kad svaki poddomen sigurno radi preko HTTPS-a.
 *
 * `Content-Security-Policy` ovde nije — traži `nonce` po zahtevu, dakle prolaz
 * kroz middleware, i ide kao zasebna izmena. Do tada `X-Frame-Options` pokriva
 * ono zbog čega je CSP ovde najpotrebniji.
 */
const securityHeaders = [
  // Stranica se ne sme uglaviti u tuđi okvir. Aplikacija nema nijedan iframe,
  // pa je `DENY` bez posledica — a bez njega se klijentkinja može navesti da
  // otkaže termin misleći da klikće nešto drugo.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Pun URL nosi `tenantSlug`, a na strani za otkazivanje i broj telefona.
  // Ka tuđim domenima ide samo poreklo, i to isključivo preko HTTPS-a.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
