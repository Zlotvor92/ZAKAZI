/**
 * Rok za svaki odlazak do baze.
 *
 * Bez njega zahtev prema bazi koja ne odgovara visi dok ga ne prekine sam
 * Vercel. Klijentkinja za to vreme gleda praznu belu stranu — izmereno 45
 * sekundi i dalje bez ijednog piksela — jer server komponenta nije pukla nego
 * čeka, pa `app/error.tsx` nema na šta da se zakači.
 *
 * Ista lekcija je već naučena kod slanja linka za prijavu; ovo je isto, samo
 * za pristup podacima. Rok je namerno kraći od Vercel-ovog: kad istekne,
 * `fetch` baci, `lib/db/` to pretvori u grešku, i granica greške pokaže
 * srpski tekst sa putem nazad umesto praznine.
 */
const DEADLINE_MS = 8_000;

export function withDeadline(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  // Poziv koji je i sam već prekinut (korisnik zatvorio stranu) ne sme da
  // izgubi taj razlog, pa se dva signala spajaju umesto da se naš nametne.
  const deadline = AbortSignal.timeout(DEADLINE_MS);
  const signal = init?.signal
    ? AbortSignal.any([init.signal, deadline])
    : deadline;

  return fetch(input, { ...init, signal });
}
