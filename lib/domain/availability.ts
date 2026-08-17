import { addDays, instantInTimeZone, isoWeekday } from "./calendar";

/**
 * Komad radnog vremena i koliko u njemu traje jedan termin. Blok 09:00–12:00
 * sa terminom od 90 minuta znači dva termina: u 9 i u 10:30.
 *
 * Trajanje usluge namerno ne učestvuje. Salon je taj koji je napravio blok i
 * zna šta u njega staje; aplikacija ne pogađa umesto njega.
 */
export type WorkingBlock = {
  weekday: number;
  startMinute: number;
  endMinute: number;
  slotMinutes: number;
};

/**
 * Vreme u kom izvođač ne može da radi: tuđi termin ili odsustvo. Za računanje
 * slobodnih termina razlika ne postoji, pa se spajaju pre nego što stignu ovde.
 */
export type BusyRange = { startAt: Date; endAt: Date };

export type Slot = { startAt: Date; minutes: number };

export type DayAvailability = { date: string; slots: Slot[] };

export type AvailabilityInput = {
  timeZone: string;
  /** Prvi i poslednji dan koji se nudi, oba uključena, u tajmzoni salona. */
  fromDate: string;
  toDate: string;
  blocks: WorkingBlock[];
  busy: BusyRange[];
  now: Date;
  minLeadMin: number;
};

const MINUTE = 60_000;

function overlaps(startMs: number, endMs: number, range: BusyRange): boolean {
  return startMs < range.endAt.getTime() && range.startAt.getTime() < endMs;
}

/**
 * Koliko termina staje u blok. Ostatak koji ne puni ceo termin se ne nudi —
 * bolje nego da poslednji klijent dobije kraće vreme nego što mu treba.
 */
export function slotsInBlock(block: WorkingBlock): number {
  if (block.slotMinutes <= 0) {
    return 0;
  }

  return Math.floor((block.endMinute - block.startMinute) / block.slotMinutes);
}

/** Trajanje termina kad salon kaže koliko ih hoće u bloku. */
export function slotMinutesForCount(
  startMinute: number,
  endMinute: number,
  count: number,
): number {
  if (count <= 0) {
    return endMinute - startMinute;
  }

  return Math.floor((endMinute - startMinute) / count);
}

/**
 * Slobodni termini, dan po dan.
 *
 * Termin zauzima ceo svoj deo bloka, pa se sledeći klijent zakazuje tačno kad
 * se prethodni završi. Rupa između termina nema jer ih nema odakle biti.
 */
export function buildAvailability(input: AvailabilityInput): DayAvailability[] {
  const earliestMs = input.now.getTime() + input.minLeadMin * MINUTE;
  const days: DayAvailability[] = [];

  for (
    let date = input.fromDate;
    date <= input.toDate;
    date = addDays(date, 1)
  ) {
    const weekday = isoWeekday(date);
    const slots: Slot[] = [];

    for (const block of input.blocks) {
      if (block.weekday !== weekday || block.slotMinutes <= 0) {
        continue;
      }

      const opensMs = instantInTimeZone(
        date,
        block.startMinute,
        input.timeZone,
      ).getTime();
      const closesMs = instantInTimeZone(
        date,
        block.endMinute,
        input.timeZone,
      ).getTime();
      const slotMs = block.slotMinutes * MINUTE;

      for (
        let startMs = opensMs;
        startMs + slotMs <= closesMs;
        startMs += slotMs
      ) {
        if (startMs < earliestMs) {
          continue;
        }

        const taken = input.busy.some((range) =>
          overlaps(startMs, startMs + slotMs, range),
        );

        if (!taken) {
          slots.push({
            startAt: new Date(startMs),
            minutes: block.slotMinutes,
          });
        }
      }
    }

    slots.sort((left, right) => left.startAt.getTime() - right.startAt.getTime());
    days.push({ date, slots });
  }

  return days;
}
