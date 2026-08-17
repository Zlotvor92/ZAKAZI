import { describe, expect, it } from "vitest";
import {
  blocksOfDay,
  defaultWeek,
  emptyWeek,
  slotCounts,
  toBlocks,
  toDayShapes,
  validateDay,
  withSlotCount,
  type DayShape,
} from "@/lib/domain/working-hours";

function day(overrides: Partial<DayShape> = {}): DayShape {
  return {
    weekday: 1,
    working: true,
    startMinute: 9 * 60,
    endMinute: 12 * 60,
    breakStartMinute: null,
    breakEndMinute: null,
    slotMinutes: 90,
    ...overrides,
  };
}

/** Dan kakav ima sestrin salon: 09–12 i 17–20, termin sat i po. */
function sisterDay(): DayShape {
  return day({
    endMinute: 20 * 60,
    breakStartMinute: 12 * 60,
    breakEndMinute: 17 * 60,
  });
}

describe("komadi rada u danu", () => {
  it("dan bez pauze je jedan komad", () => {
    expect(blocksOfDay(day())).toEqual([
      { weekday: 1, startMinute: 540, endMinute: 720, slotMinutes: 90 },
    ]);
  });

  it("dan sa pauzom je dva komada, oba sa istim trajanjem termina", () => {
    expect(blocksOfDay(sisterDay())).toEqual([
      { weekday: 1, startMinute: 540, endMinute: 720, slotMinutes: 90 },
      { weekday: 1, startMinute: 1020, endMinute: 1200, slotMinutes: 90 },
    ]);
  });

  it("neradni dan nema nijedan komad", () => {
    expect(blocksOfDay(day({ working: false }))).toEqual([]);
  });
});

describe("koliko termina ispadne", () => {
  it("sestrin dan daje dva pre i dva posle podne", () => {
    expect(slotCounts(sisterDay())).toEqual([2, 2]);
  });

  it("blokovi različite dužine daju različit broj uz isti razmak", () => {
    const uneven = day({
      endMinute: 20 * 60,
      breakStartMinute: 13 * 60,
      breakEndMinute: 17 * 60,
    });

    // 09–13 su četiri sata: dolazi se u 9, 10:30 i 12. 17–20 su tri sata:
    // dolazi se u 17 i 18:30.
    expect(slotCounts(uneven)).toEqual([3, 2]);
  });
});

describe("unos preko broja termina", () => {
  it("dva termina u bloku od tri sata daju termin od sat i po", () => {
    expect(withSlotCount(day(), 2).slotMinutes).toBe(90);
  });

  it("tri termina u bloku od tri sata daju termin od sat", () => {
    expect(withSlotCount(day(), 3).slotMinutes).toBe(60);
  });

  it("broj se odnosi na prvi komad, ostali nasleđuju trajanje", () => {
    const changed = withSlotCount(sisterDay(), 2);

    expect(changed.slotMinutes).toBe(90);
    expect(slotCounts(changed)).toEqual([2, 2]);
  });

  it("neradni dan se ne dira", () => {
    const closed = day({ working: false });

    expect(withSlotCount(closed, 3)).toEqual(closed);
  });
});

describe("provera dana", () => {
  it("ispravan dan prolazi", () => {
    expect(validateDay(day())).toBeNull();
    expect(validateDay(sisterDay())).toBeNull();
  });

  it("neradni dan se ne proverava", () => {
    expect(
      validateDay(day({ working: false, startMinute: 900, endMinute: 60 })),
    ).toBeNull();
  });

  it("kraj pre početka ne prolazi", () => {
    expect(validateDay(day({ startMinute: 720, endMinute: 540 }))).toBe(
      "end_before_start",
    );
  });

  it("polovična ili obrnuta pauza ne prolazi", () => {
    expect(validateDay(day({ breakStartMinute: 600 }))).toBe(
      "break_end_before_start",
    );
    expect(
      validateDay(
        day({
          endMinute: 20 * 60,
          breakStartMinute: 17 * 60,
          breakEndMinute: 12 * 60,
        }),
      ),
    ).toBe("break_end_before_start");
  });

  it("pauza koja dodiruje kraj dana nije pauza", () => {
    expect(
      validateDay(day({ breakStartMinute: 10 * 60, breakEndMinute: 12 * 60 })),
    ).toBe("break_outside_day");
  });

  it("razmak duži od komada rada je dozvoljen: prima se jednom", () => {
    expect(validateDay(day({ slotMinutes: 200 }))).toBeNull();
    expect(slotCounts(day({ slotMinutes: 200 }))).toEqual([1]);
  });

  it("razmak koji ne postoji je greška", () => {
    expect(validateDay(day({ slotMinutes: 0 }))).toBe("slot_invalid");
  });
});

describe("dani u redove za bazu", () => {
  it("sestrina nedelja daje dva reda po radnom danu", () => {
    const week = emptyWeek().map((shape) =>
      shape.weekday <= 5 ? { ...sisterDay(), weekday: shape.weekday } : shape,
    );

    const blocks = toBlocks(week);

    expect(blocks).toHaveLength(10);
    expect(blocks.every((block) => block.slotMinutes === 90)).toBe(true);
  });

  it("neispravan dan se preskače umesto da obori ceo upis", () => {
    expect(
      toBlocks([day({ weekday: 1, slotMinutes: 0 }), day({ weekday: 2 })]),
    ).toEqual([
      { weekday: 2, startMinute: 540, endMinute: 720, slotMinutes: 90 },
    ]);
  });

  it("prazna nedelja ne daje nijedan red", () => {
    expect(toBlocks(emptyWeek())).toEqual([]);
  });

  it("šablon daje šest radnih dana", () => {
    const weekdays = toBlocks(defaultWeek()).map((block) => block.weekday);

    expect([...new Set(weekdays)]).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("redovi iz baze nazad u formu", () => {
  it("jedan red daje dan bez pauze", () => {
    const [monday] = toDayShapes([
      { weekday: 1, startMinute: 540, endMinute: 720, slotMinutes: 90 },
    ]);

    expect(monday).toEqual({
      weekday: 1,
      working: true,
      startMinute: 540,
      endMinute: 720,
      breakStartMinute: null,
      breakEndMinute: null,
      slotMinutes: 90,
    });
  });

  it("dva reda daju dan sa pauzom", () => {
    const [monday] = toDayShapes([
      { weekday: 1, startMinute: 540, endMinute: 720, slotMinutes: 90 },
      { weekday: 1, startMinute: 1020, endMinute: 1200, slotMinutes: 90 },
    ]);

    expect(monday).toMatchObject({
      startMinute: 540,
      endMinute: 1200,
      breakStartMinute: 720,
      breakEndMinute: 1020,
      slotMinutes: 90,
    });
  });

  it("obrnut redosled redova daje isto", () => {
    const [monday] = toDayShapes([
      { weekday: 1, startMinute: 1020, endMinute: 1200, slotMinutes: 90 },
      { weekday: 1, startMinute: 540, endMinute: 720, slotMinutes: 90 },
    ]);

    expect(monday).toMatchObject({ startMinute: 540, endMinute: 1200 });
  });

  it("dan bez ijednog reda je neradni", () => {
    const shapes = toDayShapes([]);

    expect(shapes).toHaveLength(7);
    expect(shapes.every((shape) => !shape.working)).toBe(true);
  });
});

describe("put tamo i nazad", () => {
  it("sestrina nedelja preživi pretvaranje u redove i nazad", () => {
    const week = emptyWeek().map((shape) =>
      shape.weekday <= 5 ? { ...sisterDay(), weekday: shape.weekday } : shape,
    );

    expect(toDayShapes(toBlocks(week))).toEqual(week);
  });
});
