import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

const MINUTES_PER_DAY = 24 * 60;

export function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(":");
  return Number(hours) * 60 + Number(minutes ?? 0);
}

export function minutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

/**
 * Datum u tajmzoni salona. Jedino mesto gde tajmzona uopšte igra ulogu — dalje
 * se računa nad golim kalendarskim datumom, pa prelazak na letnje vreme ne
 * može da pomeri nijedan dan.
 */
export function currentDateInTimeZone(now: Date, timeZone: string): string {
  return formatInTimeZone(now, timeZone, "yyyy-MM-dd");
}

function toUtcDate(date: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!));
}

function fromUtcDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function isoWeekday(date: string): number {
  const day = toUtcDate(date).getUTCDay();
  return day === 0 ? 7 : day;
}

export function addDays(date: string, days: number): string {
  const value = toUtcDate(date);
  value.setUTCDate(value.getUTCDate() + days);
  return fromUtcDate(value);
}

export function startOfIsoWeek(date: string): string {
  return addDays(date, -(isoWeekday(date) - 1));
}

/**
 * Zidno vreme salona na dati datum pretvoreno u trenutak. Prevod ide preko
 * konkretnog datuma, nikad preko fiksnog pomeraja — samo tako 09:00 pada na
 * 09:00 i na dan kad se sat pomera.
 *
 * Postgres dozvoljava `24:00:00` kao vreme, a to je kraj dana, ne njegov
 * početak, pa se prelivanje prenosi na sledeći datum.
 */
export function instantInTimeZone(
  date: string,
  minuteOfDay: number,
  timeZone: string,
): Date {
  const dayOffset = Math.floor(minuteOfDay / MINUTES_PER_DAY);
  const withinDay = minuteOfDay - dayOffset * MINUTES_PER_DAY;

  return fromZonedTime(
    `${addDays(date, dayOffset)}T${minutesToTime(withinDay)}:00`,
    timeZone,
  );
}

/** Ponoć do ponoći po satu salona, kao trenuci u UTC-u. */
export function dayBoundsInTimeZone(
  date: string,
  timeZone: string,
): { from: Date; to: Date } {
  return {
    from: instantInTimeZone(date, 0, timeZone),
    to: instantInTimeZone(date, MINUTES_PER_DAY, timeZone),
  };
}

/** Sedam dana nedelje kojoj datum pripada, počev od ponedeljka. */
export function isoWeekDates(date: string): string[] {
  const monday = startOfIsoWeek(date);

  return Array.from({ length: 7 }, (_, offset) => addDays(monday, offset));
}
