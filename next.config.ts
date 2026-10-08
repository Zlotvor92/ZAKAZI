import type { NextConfig } from "next";
import { securityHeaders } from "./lib/domain/security-headers";

/** Host Supabase projekta, za CSP: odatle dolaze slike salona. */
function supabaseHost(): string | null {
  try {
    return new URL(process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? "").host;
  } catch {
    return null;
  }
}

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Podrazumevano je 1 MB, a logo sme da ima 2 MB (`LOGO_MAX_BYTES`): veći
      // zahtev Next odbija pre nego što stigne do akcije, pa slika koju sajt
      // smatra dozvoljenom nikad ne bi stigla do provere. Multipart omot i
      // ostala polja traže prostor iznad samog fajla.
      // Ista vrednost je u `SERVER_ACTION_BODY_LIMIT_BYTES`; test ih poredi.
      bodySizeLimit: "3mb",
    },
  },
  async headers() {
    return securityHeaders({
      production: process.env.NODE_ENV === "production",
      supabaseHost: supabaseHost(),
    });
  },
};

export default nextConfig;
