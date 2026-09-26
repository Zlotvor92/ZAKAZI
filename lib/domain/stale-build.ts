/**
 * Greška koju pravi stara verzija aplikacije posle nove objave.
 *
 * Telefon koji je stranu otvorio pre objave traži delove koda po imenima iz
 * stare verzije. Posle objave ih više nema, pa učitavanje pukne — ne zbog
 * greške u kodu, nego zato što je strana zastarela. Lek je puno osvežavanje.
 *
 * Tekst se razlikuje po alatu i pregledaču, pa se hvata svaki poznat oblik.
 */
const STALE_BUILD_PATTERNS = [
  /Failed to load chunk/i,
  /Loading (CSS )?chunk [\w-]+ failed/i,
  /ChunkLoadError/i,
  /Importing a module script failed/i,
  /Failed to fetch dynamically imported module/i,
];

export function isStaleBuildError(error: { name?: string; message: string }): boolean {
  return (
    error.name === "ChunkLoadError" ||
    STALE_BUILD_PATTERNS.some((pattern) => pattern.test(error.message))
  );
}

/** Posle ovoliko se ista strana sme ponovo sama osvežiti. */
export const RELOAD_COOLDOWN_MS = 30_000;

/**
 * Da li sme još jedno samostalno osvežavanje.
 *
 * Ako je strana pukla istom greškom i odmah posle osvežavanja, problem nije
 * zastarela verzija, pa bi novo osvežavanje samo vrtelo stranu u krug.
 */
export function mayReloadAgain(lastReloadAt: number | null, now: number): boolean {
  return lastReloadAt === null || now - lastReloadAt >= RELOAD_COOLDOWN_MS;
}
