import { isStaleBuildError, mayReloadAgain } from "@/lib/domain/stale-build";

const STORAGE_KEY = "zastarela-verzija-osvezeno";

/**
 * Osveži stranu ako je greška posledica nove objave. Vraća `true` kad je
 * osvežavanje pokrenuto — tada greška nije za prijavu.
 *
 * Bez pristupa `sessionStorage` (privatni režim, zabranjen) ne osvežava:
 * bez pamćenja nema zaštite od vrtenja u krug.
 */
export function reloadIfStaleBuild(error: { name?: string; message: string }): boolean {
  if (!isStaleBuildError(error)) {
    return false;
  }

  try {
    const stored = window.sessionStorage.getItem(STORAGE_KEY);
    const now = Date.now();

    if (!mayReloadAgain(stored === null ? null : Number(stored), now)) {
      return false;
    }

    window.sessionStorage.setItem(STORAGE_KEY, String(now));
  } catch {
    return false;
  }

  window.location.reload();
  return true;
}
