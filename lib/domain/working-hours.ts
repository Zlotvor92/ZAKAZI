import type { WorkingInterval } from "./calendar";

/**
 * Radno vreme kako ga vlasnica misli: jedan dan, od kad do kad, i pauza u
 * sredini. U bazi je to više redova po danu, a pauza je rupa između njih —
 * pojam „pauza" tamo ne postoji i ne treba da postoji.
 */
export type DayShape = {
  weekday: number;
  working: boolean;
  startMinute: number;
  endMinute: number;
  breakStartMinute: number | null;
  breakEndMinute: number | null;
};

export type DayProblem =
  | "end_before_start"
  | "break_outside_day"
  | "break_end_before_start";

const MINUTES_PER_DAY = 24 * 60;

export function emptyWeek(): DayShape[] {
  return Array.from({ length: 7 }, (_, index) => ({
    weekday: index + 1,
    working: false,
    startMinute: 9 * 60,
    endMinute: 17 * 60,
    breakStartMinute: null,
    breakEndMinute: null,
  }));
}

/** Šablon koji se nudi salonu koji još ništa nije uneo. */
export function defaultWeek(): DayShape[] {
  return emptyWeek().map((day) =>
    day.weekday <= 5
      ? { ...day, working: true }
      : day.weekday === 6
        ? { ...day, working: true, startMinute: 9 * 60, endMinute: 14 * 60 }
        : day,
  );
}

export function validateDay(day: DayShape): DayProblem | null {
  if (!day.working) {
    return null;
  }

  if (
    day.startMinute >= day.endMinute ||
    day.startMinute < 0 ||
    day.endMinute > MINUTES_PER_DAY
  ) {
    return "end_before_start";
  }

  const { breakStartMinute: from, breakEndMinute: to } = day;

  if (from === null && to === null) {
    return null;
  }

  if (from === null || to === null) {
    return "break_end_before_start";
  }

  if (from >= to) {
    return "break_end_before_start";
  }

  // Pauza mora da ostavi rad i pre i posle sebe; inače to nije pauza nego
  // drugačije radno vreme.
  if (from <= day.startMinute || to >= day.endMinute) {
    return "break_outside_day";
  }

  return null;
}

/** Dani u ono što baza čuva: jedan red po neprekidnom komadu rada. */
export function toIntervals(days: DayShape[]): WorkingInterval[] {
  const intervals: WorkingInterval[] = [];

  for (const day of days) {
    if (!day.working || validateDay(day) !== null) {
      continue;
    }

    if (day.breakStartMinute === null || day.breakEndMinute === null) {
      intervals.push({
        weekday: day.weekday,
        startMinute: day.startMinute,
        endMinute: day.endMinute,
      });
      continue;
    }

    intervals.push({
      weekday: day.weekday,
      startMinute: day.startMinute,
      endMinute: day.breakStartMinute,
    });
    intervals.push({
      weekday: day.weekday,
      startMinute: day.breakEndMinute,
      endMinute: day.endMinute,
    });
  }

  return intervals;
}

/**
 * Ono što je u bazi nazad u oblik za formu. Tri i više komada u danu forma ne
 * ume da prikaže, pa se svode na prvi i poslednji, a sve između postaje pauza
 * — bolje nego da ekran ostane prazan nad podacima koje ne razume.
 */
export function toDayShapes(intervals: WorkingInterval[]): DayShape[] {
  return emptyWeek().map((day) => {
    const pieces = intervals
      .filter((interval) => interval.weekday === day.weekday)
      .sort((left, right) => left.startMinute - right.startMinute);

    if (pieces.length === 0) {
      return day;
    }

    const first = pieces[0]!;
    const last = pieces.at(-1)!;

    return {
      weekday: day.weekday,
      working: true,
      startMinute: first.startMinute,
      endMinute: last.endMinute,
      breakStartMinute: pieces.length > 1 ? first.endMinute : null,
      breakEndMinute: pieces.length > 1 ? last.startMinute : null,
    };
  });
}
