/**
 * Tajna kojom klijentkinja dokazuje da je termin njen.
 *
 * Pregledač je smisli pri zakazivanju (256 nasumičnih bita, base64url), server
 * je pamti u kolačiću telefona, a baza čuva samo njen SHA-256. Broj telefona je
 * poznat salonu i svakome kome ga je klijentkinja dala, pa sam ne sme da otvara
 * termin; tajna je ono što zna samo ona koja ga je zakazala.
 */

const PROOF_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const PROOF_BYTES = 32;

/**
 * Koliko tajni jedan kolačić nosi. Klijentkinja ne može da ima više od
 * `too_many_upcoming` budućih termina u salonu, a starije tajne ionako ne
 * otvaraju ništa.
 */
export const MAX_REMEMBERED_PROOFS = 6;

const COOKIE_SEPARATOR = ".";
const FRAGMENT_KEY = "k";

export function isManageProof(value: unknown): value is string {
  return typeof value === "string" && PROOF_PATTERN.test(value);
}

/**
 * Nova tajna, ili `null` kad pregledač nema izvor slučajnosti. Poziva se samo
 * u pregledaču: server tajnu nikad ne smišlja, jer ponovljen zahtev posle
 * izgubljenog odgovora mora da nosi istu.
 */
export function newManageProof(): string | null {
  if (typeof crypto === "undefined" || !("getRandomValues" in crypto)) {
    return null;
  }

  const bytes = crypto.getRandomValues(new Uint8Array(PROOF_BYTES));
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

/** Tajne iz kolačića; sve što nije tajna se odbacuje, a ponavljanja se spajaju. */
export function parseProofs(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }

  const proofs: string[] = [];
  for (const candidate of raw.split(COOKIE_SEPARATOR)) {
    if (isManageProof(candidate) && !proofs.includes(candidate)) {
      proofs.push(candidate);
    }
  }

  return proofs.slice(0, MAX_REMEMBERED_PROOFS);
}

export function serializeProofs(proofs: readonly string[]): string {
  return proofs.join(COOKIE_SEPARATOR);
}

/** Najnovija prva; kad je spisak pun ispada najstarija. */
export function withProof(
  proofs: readonly string[],
  proof: string,
): string[] {
  return [proof, ...proofs.filter((existing) => existing !== proof)].slice(
    0,
    MAX_REMEMBERED_PROOFS,
  );
}

/**
 * Link koji se sačuva pri zakazivanju. Tajna stoji iza `#`, jer pregledač
 * fragment nikad ne šalje serveru: ne završava u logu, u `Referer`-u ni u
 * analitici.
 */
export function cancelLink(
  origin: string,
  slug: string,
  proof: string,
): string {
  return `${origin}/${slug}/otkazi#${FRAGMENT_KEY}=${proof}`;
}

/** Tajna iz `location.hash`, ili `null` kad je nema ili nije tajna. */
export function proofFromFragment(hash: string): string | null {
  const value = new URLSearchParams(hash.replace(/^#/, "")).get(FRAGMENT_KEY);

  return isManageProof(value) ? value : null;
}
