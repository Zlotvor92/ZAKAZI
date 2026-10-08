/**
 * Koliko dugo prozor mora da je bio skriven da bi povratak u njega osvežio
 * podatke. Kratko prebacivanje između aplikacija ne treba da puni mrežu, a
 * kalendar koji je stajao duže od ovoga ume da bude star.
 */
export const REFRESH_AFTER_AWAY_MS = 20_000;

export function shouldRefreshAfterAbsence(awayMs: number): boolean {
  return awayMs >= REFRESH_AFTER_AWAY_MS;
}

/**
 * Koliko često se kalendar koji stoji otvoren osvežava sam. Obaveštenja stižu
 * samo onima koji su ih uključili; ostali bi, bez ovoga, gledali raspored koji
 * je star koliko i poslednji dodir. Dovoljno retko da jedna vlasnica sa
 * otvorenim kalendarom ne opterećuje bazu.
 */
export const POLL_INTERVAL_MS = 90_000;

/** Osvežava se samo kalendar koji neko gleda i koji može da stigne do servera. */
export function shouldPoll(state: { visible: boolean; online: boolean }): boolean {
  return state.visible && state.online;
}

/** Poruka koju servisni radnik šalje otvorenom prozoru kad stigne obaveštenje. */
export function isRefreshMessage(data: unknown): boolean {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "refresh"
  );
}
