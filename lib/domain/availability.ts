import { fromZonedTime } from "date-fns-tz";
import {
  addDays,
  isoWeekday,
  minutesToTime,
  type WorkingInterval,
} from "./calendar";

/**
 * Na koliko se minuta nude vremena početka. Ista vrednost stoji u
 * `public_book`, koja odbija termin van mreže — ako se menja, menja se na oba
 * mesta.
 */
export const SLOT_STEP_MIN = 15;

/**
 * Vreme u kom izvođač ne može da radi: tuđi termin zajedno sa svojim baferom,
 * ili odsustvo. Za računanje slobodnih termina razlika između to dvoje ne
 * postoji, pa se spajaju pre nego što stignu ovde.
 */
export type BusyRange = { startAt: Date; endAt: Date };

export type AvailabilityInput = {
  timeZone: string;
  /** Prvi i poslednji dan koji se nudi, oba uključena, u tajmzoni salona. */
  fromDate: string;
  toDate: string;
  workingHours: WorkingInterval[];
  busy: BusyRange[];
  durationMin: number;
  bufferAfterMin: number;
  slotStepMin: number;
  now: Date;
  minLeadMin: number;
};

export type DayAvailability = {
  date: string;
  slots: Date[];
};

const MINUTE = 60_000;
const MINUTES_PER_DAY = 24 * 60;

/**
 * Zidno vreme salona na dati datum pretvoreno u trenutak. Prevod ide preko
 * konkretnog datuma, nikad preko fiksnog pomeraja — samo tako 09:00 pada na
 * 09:00 i na dan kad se sat pomera.
 *
 * Postgres dozvoljava `24:00:00` kao vreme, a to je kraj dana, ne njegov
 * početak, pa se prelivanje prenosi na sledeći datum.
 */
function instantAt(date: string, minuteOfDay: number, timeZone: string): Date {
  const dayOffset = Math.floor(minuteOfDay / MINUTES_PER_DAY);
  const withinDay = minuteOfDay - dayOffset * MINUTES_PER_DAY;

  return fromZonedTime(
    `${addDays(date, dayOffset)}T${minutesToTime(withinDay)}:00`,
    timeZone,
  );
}

function overlaps(
  startMs: number,
  endMs: number,
  range: BusyRange,
): boolean {
  return startMs < range.endAt.getTime() && range.startAt.getTime() < endMs;
}

/**
 * Slobodni termini za jednu uslugu, dan po dan.
 *
 * Dva pravila, i namerno samo dva:
 *
 * 1. Usluga mora cela da stane unutar radnog vremena.
 * 2. Usluga zajedno sa baferom ne sme da dodirne ništa zauzeto.
 *
 * Iz toga sledi da bafer sme da pređe kraj radnog vremena — salon radi do 20h,
 * a gel lak od sat vremena sa 15 minuta spremanja sme da počne u 19h. Ne sme
 * da pređe u tuđi termin ili u odsustvo, jer to drugo pravilo ne dozvoljava,
 * i tu se poklapa sa ograničenjem koje baza ionako nameće.
 */
export function buildAvailability(input: AvailabilityInput): DayAvailability[] {
  if (input.slotStepMin <= 0) {
    throw new Error("Korak mreže termina mora biti veći od nule.");
  }

  const earliestMs = input.now.getTime() + input.minLeadMin * MINUTE;
  const serviceMs = input.durationMin * MINUTE;
  const blockedMs = (input.durationMin + input.bufferAfterMin) * MINUTE;
  const stepMs = input.slotStepMin * MINUTE;

  const days: DayAvailability[] = [];

  for (
    let date = input.fromDate;
    date <= input.toDate;
    date = addDays(date, 1)
  ) {
    const weekday = isoWeekday(date);
    const slots: Date[] = [];

    for (const interval of input.workingHours) {
      if (interval.weekday !== weekday) {
        continue;
      }

      const opensMs = instantAt(
        date,
        interval.startMinute,
        input.timeZone,
      ).getTime();
      const closesMs = instantAt(
        date,
        interval.endMinute,
        input.timeZone,
      ).getTime();

      for (
        let startMs = opensMs;
        startMs + serviceMs <= closesMs;
        startMs += stepMs
      ) {
        if (startMs < earliestMs) {
          continue;
        }

        const blockedEndMs = startMs + blockedMs;
        const taken = input.busy.some((range) =>
          overlaps(startMs, blockedEndMs, range),
        );

        if (!taken) {
          slots.push(new Date(startMs));
        }
      }
    }

    slots.sort((left, right) => left.getTime() - right.getTime());
    days.push({ date, slots });
  }

  return days;
}
