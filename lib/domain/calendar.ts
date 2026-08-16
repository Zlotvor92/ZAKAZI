import { formatInTimeZone } from "date-fns-tz";

export type WorkingInterval = {
  weekday: number;
  startMinute: number;
  endMinute: number;
};

export type CalendarDay = {
  /** Datum u tajmzoni salona, oblik YYYY-MM-DD. */
  date: string;
  /** ISO dan u nedelji: 1 = ponedeljak ... 7 = nedelja. */
  weekday: number;
  intervals: { startMinute: number; endMinute: number }[];
};

export type WeekGrid = {
  days: CalendarDay[];
  startMinute: number;
  endMinute: number;
  hourMarks: number[];
};

/** Kad salon nema unetog radnog vremena, mreža ipak mora nešto da pokaže. */
const FALLBACK_START_MINUTE = 8 * 60;
const FALLBACK_END_MINUTE = 20 * 60;

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

function gridBounds(intervals: WorkingInterval[]): {
  startMinute: number;
  endMinute: number;
} {
  if (intervals.length === 0) {
    return { startMinute: FALLBACK_START_MINUTE, endMinute: FALLBACK_END_MINUTE };
  }

  const earliest = Math.min(...intervals.map((interval) => interval.startMinute));
  const latest = Math.max(...intervals.map((interval) => interval.endMinute));

  return {
    startMinute: Math.floor(earliest / 60) * 60,
    endMinute: Math.ceil(latest / 60) * 60,
  };
}

export function buildWeekGrid(input: {
  weekStart: string;
  workingHours: WorkingInterval[];
}): WeekGrid {
  const { startMinute, endMinute } = gridBounds(input.workingHours);

  const days: CalendarDay[] = [];
  for (let offset = 0; offset < 7; offset += 1) {
    const date = addDays(input.weekStart, offset);
    const weekday = isoWeekday(date);
    const intervals = input.workingHours
      .filter((interval) => interval.weekday === weekday)
      .map((interval) => ({
        startMinute: interval.startMinute,
        endMinute: interval.endMinute,
      }))
      .sort((left, right) => left.startMinute - right.startMinute);

    days.push({ date, weekday, intervals });
  }

  const hourMarks: number[] = [];
  for (let minute = startMinute; minute <= endMinute; minute += 60) {
    hourMarks.push(minute);
  }

  return { days, startMinute, endMinute, hourMarks };
}
