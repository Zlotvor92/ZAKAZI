/**
 * Srpski ima tri oblika uz broj, a ne dva kao engleski:
 *
 * - 1 usluga, 21 usluga, 101 usluga        (jednina)
 * - 2 usluge, 3 usluge, 4 usluge, 22 usluge (paukal)
 * - 5 usluga, 11 usluga, 12 usluga, 0 usluga (množina)
 *
 * Izuzeci su 11–14: `11 % 10` je 1, ali se kaže „11 usluga", ne „11 usluga
 * jednina". Zato se gleda i ostatak pri deljenju sa 100.
 */
export type PluralForms = readonly [one: string, few: string, many: string];

export function pluralize(count: number, forms: PluralForms): string {
  const [one, few, many] = forms;
  const lastDigit = Math.abs(count) % 10;
  const lastTwo = Math.abs(count) % 100;

  if (lastTwo >= 11 && lastTwo <= 14) {
    return many;
  }

  if (lastDigit === 1) {
    return one;
  }

  if (lastDigit >= 2 && lastDigit <= 4) {
    return few;
  }

  return many;
}
