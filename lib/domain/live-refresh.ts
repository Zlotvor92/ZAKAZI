/**
 * Koliko dugo prozor mora da je bio skriven da bi povratak u njega osvežio
 * podatke. Kratko prebacivanje između aplikacija ne treba da puni mrežu, a
 * kalendar koji je stajao duže od ovoga ume da bude star.
 */
export const REFRESH_AFTER_AWAY_MS = 20_000;

export function shouldRefreshAfterAbsence(awayMs: number): boolean {
  return awayMs >= REFRESH_AFTER_AWAY_MS;
}

/** Poruka koju servisni radnik šalje otvorenom prozoru kad stigne obaveštenje. */
export function isRefreshMessage(data: unknown): boolean {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "refresh"
  );
}
