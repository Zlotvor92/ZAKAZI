import type { NextConfig } from "next";

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
};

export default nextConfig;
