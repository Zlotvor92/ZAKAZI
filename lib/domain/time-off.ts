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

type Clipped = { range: TimeOffRange; startMs: number; endMs: number };

/**
 * Delovi odsustava koji padaju u dati dan, poređani po vremenu.
 *
 * Granice dana daje tajmzona salona, pa dan u kom se menja računanje vremena
 * traje 23 ili 25 sati i odsustvo se seče po njima, ne po dvadeset četiri sata.
 */
function clipToDay(
  ranges: TimeOffRange[],
  date: string,
  timeZone: string,
): { clipped: Clipped[]; fromMs: number; toMs: number } {
  const bounds = dayBoundsInTimeZone(date, timeZone);
  const fromMs = bounds.from.getTime();
  const toMs = bounds.to.getTime();

  const clipped = ranges
    .map((range) => ({
      range,
      startMs: new Date(range.start_at).getTime(),
      endMs: new Date(range.end_at).getTime(),
    }))
    .filter(({ startMs, endMs }) => startMs < toMs && fromMs < endMs)
    .map(({ range, startMs, endMs }) => ({
      range,
      startMs: Math.max(startMs, fromMs),
      endMs: Math.min(endMs, toMs),
    }))
    .sort((left, right) => left.startMs - right.startMs);

  return { clipped, fromMs, toMs };
}

/**
 * Deo odsustva koji pada u dati dan.
 *
 * Odsustvo od petka popodne do ponedeljka ujutru je jedan red u bazi, a u
 * kalendaru tri različita reda: petak od 14 do ponoći, subota ceo dan,
 * ponedeljak od ponoći do devet.
 */
export function timeOffOfDay(
  ranges: TimeOffRange[],
  date: string,
  timeZone: string,
): DayTimeOff[] {
  const { clipped, fromMs, toMs } = clipToDay(ranges, date, timeZone);

  return clipped.map(({ range, startMs, endMs }) => ({
    id: range.id,
    startAt: new Date(startMs).toISOString(),
    endAt: new Date(endMs).toISOString(),
    wholeDay: startMs <= fromMs && endMs >= toMs,
    reason: range.reason,
  }));
}

/**
 * Da li je ceo dan pokriven odsustvom.
 *
 * Takav dan je za kalendar neradan isto kao dan bez radnog vremena: vlasnica
 * ga nije uzela do pola, uzela ga je. Gleda se sastavljeno pokrivanje, jer dva
 * uzastopna odsustva — jutro pa popodne — zajedno pojedu dan iako nijedno samo
 * ne pokriva ceo.
 */
export function dayFullyOff(
  ranges: TimeOffRange[],
  date: string,
  timeZone: string,
): boolean {
  const { clipped, fromMs, toMs } = clipToDay(ranges, date, timeZone);

  let coveredUntil = fromMs;

  for (const { startMs, endMs } of clipped) {
    if (startMs > coveredUntil) {
      return false;
    }
    coveredUntil = Math.max(coveredUntil, endMs);
  }

  return coveredUntil >= toMs;
}
