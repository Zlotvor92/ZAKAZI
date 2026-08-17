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
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
