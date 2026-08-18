import { addDays } from "./calendar";

/**
 * Stanje pretplate jednog salona.
 *
 * - `none` — datum nije postavljen, salonu se ne naplaćuje (probni period)
 * - `overdue` — plaćeno je isteklo, treba potez
 * - `due_soon` — ističe u narednih nekoliko dana
 * - `active` — plaćeno, nema šta da se radi
 *
 * Datum na koji je plaćeno je poslednji plaćen dan, ne prvi neplaćen: salon
 * plaćen do 15.09. radi i celog 15.09.
 */
export type SubscriptionState = "none" | "overdue" | "due_soon" | "active";

/** Koliko dana unapred se javlja da pretplata ističe. */
export const DUE_SOON_DAYS = 7;

export function subscriptionState(
  paidUntil: string | null,
  today: string,
  warnDays: number = DUE_SOON_DAYS,
): SubscriptionState {
  if (paidUntil === null || paidUntil === "") {
    return "none";
  }

  // Datumi su `yyyy-MM-dd`, pa poređenje niski daje isti redosled kao
  // poređenje datuma — bez pravljenja `Date` objekta i bez tajmzone u priči.
  if (paidUntil < today) {
    return "overdue";
  }

  return paidUntil <= addDays(today, warnDays) ? "due_soon" : "active";
}

/** Koliko je dana ostalo; negativno kad je isteklo. Za tekst upozorenja. */
export function daysUntil(paidUntil: string, today: string): number {
  const day = 24 * 60 * 60 * 1000;
  const from = Date.parse(`${today}T00:00:00Z`);
  const to = Date.parse(`${paidUntil}T00:00:00Z`);

  return Math.round((to - from) / day);
}
