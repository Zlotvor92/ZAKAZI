/**
 * Jedina adresa pod kojom se sajt predstavlja pretraživačima. `www` i
 * Vercel-ove adrese nisu kanonske, pa sve apsolutne adrese (kanonski link,
 * mapa sajta, strukturirani podaci) polaze odavde.
 */
export const SITE_URL = "https://doterajme.rs";

/**
 * Slika pregleda linka za stranice platforme. Stranica koja navede svoj
 * `openGraph` mora i nju da navede: Next ne nasleđuje slike iz roditelja kad
 * dete zameni ceo `openGraph` objekat.
 *
 * JPEG ispod 300 KB jer WhatsApp veće ne prikazuje u pregledu.
 */
export const PLATFORM_OG_IMAGE = {
  url: "/og.jpg",
  width: 1200,
  height: 630,
} as const;

export function absoluteUrl(path: string): string {
  return new URL(path, SITE_URL).toString();
}
