import { dayBoundsInTimeZone } from "./calendar";

/** Odsustvo kako ga baza čuva: jedan raspon, bez obzira koliko dana pokriva. */
export type TimeOffRange = {
  id: string;
  start_at: string;
  end_at: string;
  reason: string | null;
};

/** Odsustvo isečeno na jedan dan, u obliku u kom se prikazuje u kalendaru. */
export type DayTimeOff = {
  id: string;
  startAt: string;
  endAt: string;
  wholeDay: boolean;
  reason: string | null;
};

/**
 * Deo odsustva koji pada u dati dan.
 *
 * Odsustvo od petka popodne do ponedeljka ujutru je jedan red u bazi, a u
 * kalendaru tri različita reda: petak od 14 do ponoći, subota ceo dan,
 * ponedeljak od ponoći do devet. Granice dana daje tajmzona salona, pa dan u
 * kom se menja računanje vremena traje 23 ili 25 sati i odsustvo se seče po
 * njima, ne po dvadeset četiri sata.
 */
export function timeOffOfDay(
  ranges: TimeOffRange[],
  date: string,
  timeZone: string,
): DayTimeOff[] {
  const bounds = dayBoundsInTimeZone(date, timeZone);

  return ranges
    .map((range) => ({
      range,
      startAt: new Date(range.start_at),
      endAt: new Date(range.end_at),
    }))
    .filter(({ startAt, endAt }) => startAt < bounds.to && bounds.from < endAt)
    .sort((left, right) => left.startAt.getTime() - right.startAt.getTime())
    .map(({ range, startAt, endAt }) => ({
      id: range.id,
      startAt: (startAt > bounds.from ? startAt : bounds.from).toISOString(),
      endAt: (endAt < bounds.to ? endAt : bounds.to).toISOString(),
      wholeDay: startAt <= bounds.from && endAt >= bounds.to,
      reason: range.reason,
    }));
}
