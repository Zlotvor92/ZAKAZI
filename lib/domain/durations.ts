/** Trajanja koja solo majstor stvarno koristi; ostalo je kucanje bez potrebe. */
export const COMMON_DURATIONS = [30, 45, 60, 90, 120, 150, 180, 240] as const;

/**
 * Trajanja koja forma nudi: uobičajena, uz trajanja usluga i vrednost koja je
 * trenutno izabrana. Bez ovoga usluga od 75 minuta nema opciju u listi, pa
 * pregledač tiho izabere prvu ponuđenu i termin dobije pogrešno trajanje.
 */
export function durationOptions(
  extra: readonly number[],
): number[] {
  return [...new Set([...COMMON_DURATIONS, ...extra])]
    .filter((minutes) => Number.isInteger(minutes) && minutes > 0)
    .sort((a, b) => a - b);
}
