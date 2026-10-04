/**
 * Jedina adresa pod kojom se sajt predstavlja pretraživačima. `www` i
 * Vercel-ove adrese nisu kanonske, pa sve apsolutne adrese (kanonski link,
 * mapa sajta, strukturirani podaci) polaze odavde.
 */
export const SITE_URL = "https://doterajme.rs";

export function absoluteUrl(path: string): string {
  return new URL(path, SITE_URL).toString();
}
