import { cookies } from "next/headers";
import {
  parseProofs,
  serializeProofs,
  withProof,
} from "@/lib/domain/manage-proof";

const PROOF_COOKIE = "zakazi_termini";

// Duže od najdaljeg horizonta zakazivanja (90 dana); starija tajna ionako ne
// otvara nijedan budući termin.
const PROOF_COOKIE_MAX_AGE = 60 * 60 * 24 * 120;

const SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/;

/**
 * Tajne termina sa ovog pregledača. Kolačić je vezan za putanju salona, pa
 * pregledač šalje samo tajne salona čiju stranu otvaraš.
 */
export async function readProofs(): Promise<string[]> {
  const jar = await cookies();

  return parseProofs(jar.get(PROOF_COOKIE)?.value);
}

/** Pamti tajnu termina na ovom pregledaču. Poziva se samo iz server akcije. */
export async function rememberProof(
  slug: string,
  proof: string,
): Promise<void> {
  if (!SLUG_PATTERN.test(slug)) {
    return;
  }

  const jar = await cookies();
  const current = parseProofs(jar.get(PROOF_COOKIE)?.value);

  jar.set(PROOF_COOKIE, serializeProofs(withProof(current, proof)), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: PROOF_COOKIE_MAX_AGE,
    path: `/${slug}`,
  });
}
