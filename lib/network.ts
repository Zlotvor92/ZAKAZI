import { createHash } from "node:crypto";
import { headers } from "next/headers";

/**
 * Otisak mreže sa koje je zahtev stigao.
 *
 * Sama adresa se nigde ne čuva niti prosleđuje bazi — čuva se samo njen heš,
 * i to zasoljen salonom. Ista klijentkinja u dva salona daje dva različita
 * heša, pa se ni sa pristupom bazi ne može sastaviti spisak toga ko je gde
 * bio. Heš služi samo brojanju, i to unutar jednog sata.
 *
 * Vraća `null` kad adresa ne stigne, jer je jedna zajednička vrednost za sve
 * bez adrese gora od nijedne: brojala bi nepovezane ljude kao jednog.
 */
export async function networkHash(tenantSlug: string): Promise<string | null> {
  const incoming = await headers();

  // Vercel upisuje `x-forwarded-for`; prva stavka je posetilac, ostalo su
  // posrednici kroz koje je zahtev prošao.
  const address =
    incoming.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    incoming.get("x-real-ip")?.trim();

  if (!address) {
    return null;
  }

  return createHash("sha256")
    .update(`${tenantSlug}:${address}`)
    .digest("base64url")
    .slice(0, 32);
}
