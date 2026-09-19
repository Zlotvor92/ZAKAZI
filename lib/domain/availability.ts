import { addDays, instantInTimeZone, isoWeekday } from "./calendar";

/**
 * Komad radnog vremena i razmak na koji salon prima. Blok 09:00–12:00 sa
 * razmakom od 90 minuta znači da se dolazi u 9 i u 10:30.
 *
 * Razmak nije isto što i trajanje usluge. Razmak je raspored koji salon drži;
 * trajanje je koliko konkretan posao stvarno oduzme. Kad su različiti, trajanje
 * gura ono što dolazi posle.
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
  /** Koliko traje usluga koju klijent bira. */
  serviceMinutes: number;
  now: Date;
  minLeadMin: number;
  /** Koliko usluga sme da pređe u pauzu, u minutima. */
  breakOverrunMin: number;
  /** Koliko usluga sme da pređe kraj radnog dana, u minutima. */
  shiftOverrunMin: number;
};

const MINUTE = 60_000;

/**
 * Da li posle ovog bloka istog dana sledi još rada.
 *
 * Kraj poslednjeg bloka je kraj radnog dana; kraj svakog ranijeg je početak
 * pauze. Salon ta dva ograničava odvojeno: u pauzu se sme ući koliko i ona
 * traje, a posle kraja dana se ostaje samo koliko se ostaje.
 */
function breakFollows(block: WorkingBlock, blocks: WorkingBlock[]): boolean {
  return blocks.some(
    (other) =>
      other.weekday === block.weekday && other.startMinute > block.startMinute,
  );
}

function overlaps(startMs: number, endMs: number, range: BusyRange): boolean {
  return startMs < range.endAt.getTime() && range.startAt.getTime() < endMs;
}

/**
 * Koliko se puta u bloku dolazi. Mesto se broji po tome kad se počinje, ne
 * kad se završava: koliko poslednji termin sme da pređe kraj bloka odlučuje
 * salon svojim podešavanjem, a ne ovaj broj.
 */
export function slotsInBlock(block: WorkingBlock): number {
  if (block.slotMinutes <= 0) {
    return 0;
  }

  return Math.ceil((block.endMinute - block.startMinute) / block.slotMinutes);
}

/** Razmak kad salon kaže koliko puta hoće da primi u bloku. */
export function slotMinutesForCount(
  startMinute: number,
  endMinute: number,
  count: number,
): number {
  if (count <= 0) {
    return endMinute - startMinute;
  }

  return Math.ceil((endMinute - startMinute) / count);
}

/**
 * Slobodni termini za jednu uslugu, dan po dan.
 *
 * Ponuđena vremena su raspored salona, plus trenutak u kom se završava svaki
 * već zakazan termin. To drugo je ono što pomera dan: ako neko uzme dvočasovnu
 * nadogradnju u 9, u 10:30 se više ne može, ali se može u 11.
 *
 * Termin sme da pređe kraj bloka onoliko koliko salon dozvoli — posebno za
 * pauzu, posebno za kraj dana. Ne sme da pređe u tuđi.
 */
export function buildAvailability(input: AvailabilityInput): DayAvailability[] {
  const earliestMs = input.now.getTime() + input.minLeadMin * MINUTE;
  const serviceMs = input.serviceMinutes * MINUTE;
  const days: DayAvailability[] = [];

  for (
    let date = input.fromDate;
    date <= input.toDate;
    date = addDays(date, 1)
  ) {
    const weekday = isoWeekday(date);
    const starts = new Set<number>();

    for (const block of input.blocks) {
      if (
        block.weekday !== weekday ||
        block.slotMinutes <= 0 ||
        input.serviceMinutes <= 0
      ) {
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

      const candidates: number[] = [];

      for (let index = 0; index < slotsInBlock(block); index += 1) {
        candidates.push(opensMs + index * block.slotMinutes * MINUTE);
      }

      // Kraj svakog zauzetog komada je novi mogući početak: tako dvočasovni
      // termin u 9 pomeri sledeći sa 10:30 na 11.
      for (const range of input.busy) {
        const endMs = range.endAt.getTime();
        if (endMs > opensMs && endMs < closesMs) {
          candidates.push(endMs);
        }
      }

      const overrunMin = breakFollows(block, input.blocks)
        ? input.breakOverrunMin
        : input.shiftOverrunMin;
      const latestEndMs = closesMs + overrunMin * MINUTE;

      for (const startMs of candidates) {
        if (startMs < opensMs || startMs >= closesMs) {
          continue;
        }
        if (startMs + serviceMs > latestEndMs) {
          continue;
        }
        if (startMs < earliestMs) {
          continue;
        }
        if (
          input.busy.some((range) => overlaps(startMs, startMs + serviceMs, range))
        ) {
          continue;
        }

        starts.add(startMs);
      }
    }

    days.push({
      date,
      slots: [...starts]
        .sort((left, right) => left - right)
        .map((startMs) => ({
          startAt: new Date(startMs),
          minutes: input.serviceMinutes,
        })),
    });
  }

  return days;
}
