/**
 * HTTP zaštite koje svaki odgovor nosi.
 *
 * CSP je za sada samo `Report-Only`: pregledač ne blokira ništa, nego prijavljuje
 * šta bi blokirao. Tek kad izveštaji pokažu da ne pogađa ni jedan stvaran resurs
 * (Next, Supabase slike, font, video), prelazi se na `Content-Security-Policy`.
 *
 * `'unsafe-inline'` za skripte je trenutno potreban: Next ubacuje inline skripte
 * za hidrataciju, a JSON-LD na stranicama salona je inline. Strožu politiku
 * (nonce) treba uvesti tek pošto izveštaji budu čisti.
 */
export type HeaderRule = {
  source: string;
  headers: { key: string; value: string }[];
};

export const CSP_REPORT_PATH = "/api/csp";

function contentSecurityPolicy(supabaseHost: string | null): string {
  // Slike salona (logo) dolaze iz Supabase Storage-a; samo taj host, ne svi.
  const images = ["'self'", "data:", "blob:"];
  if (supabaseHost) {
    images.push(`https://${supabaseHost}`);
  }

  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    `img-src ${images.join(" ")}`,
    "font-src 'self' data:",
    "connect-src 'self'",
    "media-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    `report-uri ${CSP_REPORT_PATH}`,
  ].join("; ");
}

export function securityHeaders(options: {
  production: boolean;
  supabaseHost: string | null;
}): HeaderRule[] {
  const headers = [
    // Stranice se ne pretvaraju u drugi tip sadržaja.
    { key: "X-Content-Type-Options", value: "nosniff" },
    // Adresa sa putanjom (salon, termin) ne odlazi na tuđe sajtove.
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    // Nijedna strana ne ide u okvir: zaštita od uokviravanja (clickjacking).
    // `frame-ancestors` iz CSP-a isto to kaže, ali ga Report-Only ignoriše.
    { key: "X-Frame-Options", value: "DENY" },
    // Aplikacija ne koristi ništa od ovoga, pa ne sme ni treći kod u njoj.
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    },
  ];

  if (options.production) {
    headers.push({
      key: "Content-Security-Policy-Report-Only",
      value: contentSecurityPolicy(options.supabaseHost),
    });
  }

  return [{ source: "/:path*", headers }];
}
