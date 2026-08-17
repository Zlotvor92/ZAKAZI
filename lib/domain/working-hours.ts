import type { WorkingBlock } from "./availability";
import { slotMinutesForCount, slotsInBlock } from "./availability";

/**
 * Radno vreme kako ga vlasnica misli: jedan dan, od kad do kad, pauza u
 * sredini i koliko traje jedan termin. U bazi je to jedan red po komadu rada,
 * a pauza je rupa između njih — pojam „pauza" tamo ne postoji.
 *
 * Trajanje termina je jedno za ceo dan. Kad su blokovi različite dužine,
 * broj termina se razlikuje a trajanje ostaje isto — što je i poštenije prema
 * klijentu nego da mu termin traje drugačije pre i posle podne.
 */
export type DayShape = {
  weekday: number;
  working: boolean;
  startMinute: number;
  endMinute: number;
  breakStartMinute: number | null;
  breakEndMinute: number | null;
  slotMinutes: number;
};

export type DayProblem =
  | "end_before_start"
  | "break_outside_day"
  | "break_end_before_start"
  | "slot_too_long";

const MINUTES_PER_DAY = 24 * 60;
const DEFAULT_SLOT_MINUTES = 60;

export function emptyWeek(): DayShape[] {
  return Array.from({ length: 7 }, (_, index) => ({
    weekday: index + 1,
    working: false,
    startMinute: 9 * 60,
    endMinute: 17 * 60,
    breakStartMinute: null,
    breakEndMinute: null,
    slotMinutes: DEFAULT_SLOT_MINUTES,
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

/** Komadi rada u danu: jedan bez pauze, dva sa pauzom. */
export function blocksOfDay(day: DayShape): WorkingBlock[] {
  if (!day.working) {
    return [];
  }

  const base = { weekday: day.weekday, slotMinutes: day.slotMinutes };

  if (day.breakStartMinute === null || day.breakEndMinute === null) {
    return [
      { ...base, startMinute: day.startMinute, endMinute: day.endMinute },
    ];
  }

  return [
    { ...base, startMinute: day.startMinute, endMinute: day.breakStartMinute },
    { ...base, startMinute: day.breakEndMinute, endMinute: day.endMinute },
  ];
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

  if (from !== null || to !== null) {
    if (from === null || to === null || from >= to) {
      return "break_end_before_start";
    }

    // Pauza mora da ostavi rad i pre i posle sebe; inače to nije pauza nego
    // drugačije radno vreme.
    if (from <= day.startMinute || to >= day.endMinute) {
      return "break_outside_day";
    }
  }

  // Termin duži od najkraćeg komada rada znači da u taj komad ne staje niko.
  if (
    day.slotMinutes <= 0 ||
    blocksOfDay(day).some((block) => slotsInBlock(block) < 1)
  ) {
    return "slot_too_long";
  }

  return null;
}

/** Dani u ono što baza čuva: jedan red po neprekidnom komadu rada. */
export function toBlocks(days: DayShape[]): WorkingBlock[] {
  return days
    .filter((day) => day.working && validateDay(day) === null)
    .flatMap(blocksOfDay);
}

/**
 * Ono što je u bazi nazad u oblik za formu. Tri i više komada u danu forma ne
 * ume da prikaže, pa se svode na prvi i poslednji, a sve između postaje pauza
 * — bolje nego da ekran ostane prazan nad podacima koje ne razume.
 */
export function toDayShapes(blocks: WorkingBlock[]): DayShape[] {
  return emptyWeek().map((day) => {
    const pieces = blocks
      .filter((block) => block.weekday === day.weekday)
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
      slotMinutes: first.slotMinutes,
    };
  });
}

/**
 * Isti podatak, drugi način unosa: vlasnica kaže koliko termina hoće u prvom
 * komadu dana, a iz toga sledi koliko jedan traje. Ostali komadi zadržavaju to
 * isto trajanje, pa im se broj termina razlikuje ako su druge dužine.
 */
export function withSlotCount(day: DayShape, count: number): DayShape {
  const [first] = blocksOfDay(day);

  if (!first) {
    return day;
  }

  return {
    ...day,
    slotMinutes: slotMinutesForCount(
      first.startMinute,
      first.endMinute,
      count,
    ),
  };
}

/** Koliko termina ispadne po komadu dana, radi ispisa ispod polja. */
export function slotCounts(day: DayShape): number[] {
  return blocksOfDay(day).map(slotsInBlock);
}
