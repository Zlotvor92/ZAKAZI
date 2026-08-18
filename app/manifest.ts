import type { MetadataRoute } from "next";
import { sr } from "@/lib/i18n/sr";

/**
 * Bez manifesta iPhone ne dozvoljava obaveštenja: na iOS-u ona rade samo kad
 * je sajt dodat na početni ekran, a to traži manifest i `standalone`.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: sr.app.name,
    short_name: sr.app.name,
    description: sr.app.description,
    start_url: "/dashboard",
    display: "standalone",
    // Boje su aplikacijine, ne salonove: ovaj manifest deli svaki salon, a
    // svaki od njih ima svoju boju na javnoj strani.
    background_color: "#ffffff",
    theme_color: "#4d213c",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      // Android seče ikonu u svoj oblik. Ova verzija ima znak umanjen tako da
      // ostane ceo unutar kruga koji sečenje poštuje.
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
