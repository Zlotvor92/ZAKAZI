import { describe, expect, it } from "vitest";
import {
  defaultWeek,
  emptyWeek,
  toDayShapes,
  toIntervals,
  validateDay,
  type DayShape,
} from "@/lib/domain/working-hours";

function day(overrides: Partial<DayShape> = {}): DayShape {
  return {
    weekday: 1,
    working: true,
    startMinute: 9 * 60,
    endMinute: 17 * 60,
    breakStartMinute: null,
    breakEndMinute: null,
    ...overrides,
  };
}

describe("provera jednog dana", () => {
  it("dan bez pauze je ispravan", () => {
    expect(validateDay(day())).toBeNull();
  });

  it("neradni dan se ne proverava", () => {
    expect(validateDay(day({ working: false, startMinute: 900, endMinute: 60 }))).toBeNull();
  });

  it("kraj pre početka ne prolazi", () => {
    expect(validateDay(day({ startMinute: 17 * 60, endMinute: 9 * 60 }))).toBe(
      "end_before_start",
    );
  });

  it("isto vreme za početak i kraj ne prolazi", () => {
    expect(validateDay(day({ startMinute: 600, endMinute: 600 }))).toBe(
      "end_before_start",
    );
  });

  it("pauza sa krajem pre početka ne prolazi", () => {
    expect(
      validateDay(day({ breakStartMinute: 14 * 60, breakEndMinute: 13 * 60 })),
    ).toBe("break_end_before_start");
  });

  it("polovična pauza ne prolazi", () => {
    expect(validateDay(day({ breakStartMinute: 13 * 60 }))).toBe(
      "break_end_before_start",
    );
    expect(validateDay(day({ breakEndMinute: 14 * 60 }))).toBe(
      "break_end_before_start",
    );
  });

  it("pauza koja dodiruje početak ili kraj dana nije pauza", () => {
    expect(
      validateDay(day({ breakStartMinute: 9 * 60, breakEndMinute: 11 * 60 })),
    ).toBe("break_outside_day");
    expect(
      validateDay(day({ breakStartMinute: 15 * 60, breakEndMinute: 17 * 60 })),
    ).toBe("break_outside_day");
  });

  it("ispravna pauza prolazi", () => {
    expect(
      validateDay(day({ breakStartMinute: 13 * 60, breakEndMinute: 14 * 60 })),
    ).toBeNull();
  });

  it("radno vreme do ponoći prolazi", () => {
    expect(validateDay(day({ startMinute: 20 * 60, endMinute: 24 * 60 }))).toBeNull();
  });
});

describe("dani u redove za bazu", () => {
  it("dan bez pauze daje jedan red", () => {
    expect(toIntervals([day()])).toEqual([
      { weekday: 1, startMinute: 540, endMinute: 1020 },
    ]);
  });

  it("dan sa pauzom daje dva reda, a pauza je rupa između njih", () => {
    expect(
      toIntervals([day({ breakStartMinute: 13 * 60, breakEndMinute: 14 * 60 })]),
    ).toEqual([
      { weekday: 1, startMinute: 540, endMinute: 780 },
      { weekday: 1, startMinute: 840, endMinute: 1020 },
    ]);
  });

  it("neradni dan ne daje nijedan red", () => {
    expect(toIntervals([day({ working: false })])).toEqual([]);
  });

  it("neispravan dan se preskače umesto da obori ceo upis", () => {
    expect(
      toIntervals([
        day({ weekday: 1, startMinute: 1020, endMinute: 540 }),
        day({ weekday: 2 }),
      ]),
    ).toEqual([{ weekday: 2, startMinute: 540, endMinute: 1020 }]);
  });

  it("prazna nedelja ne daje nijedan red", () => {
    expect(toIntervals(emptyWeek())).toEqual([]);
  });

  it("šablon daje pet radnih dana i subotu", () => {
    const intervals = toIntervals(defaultWeek());

    expect(intervals.map((interval) => interval.weekday)).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
    expect(intervals.at(-1)).toEqual({
      weekday: 6,
      startMinute: 540,
      endMinute: 840,
    });
  });
});

describe("redovi iz baze nazad u formu", () => {
  it("jedan red daje dan bez pauze", () => {
    const [monday] = toDayShapes([
      { weekday: 1, startMinute: 540, endMinute: 1020 },
    ]);

    expect(monday).toEqual({
      weekday: 1,
      working: true,
      startMinute: 540,
      endMinute: 1020,
      breakStartMinute: null,
      breakEndMinute: null,
    });
  });

  it("dva reda daju dan sa pauzom", () => {
    const [monday] = toDayShapes([
      { weekday: 1, startMinute: 540, endMinute: 780 },
      { weekday: 1, startMinute: 960, endMinute: 1200 },
    ]);

    expect(monday).toMatchObject({
      startMinute: 540,
      endMinute: 1200,
      breakStartMinute: 780,
      breakEndMinute: 960,
    });
  });

  it("redovi u obrnutom redosledu daju isto", () => {
    const [monday] = toDayShapes([
      { weekday: 1, startMinute: 960, endMinute: 1200 },
      { weekday: 1, startMinute: 540, endMinute: 780 },
    ]);

    expect(monday).toMatchObject({ startMinute: 540, endMinute: 1200 });
  });

  it("dan bez ijednog reda je neradni", () => {
    const shapes = toDayShapes([]);

    expect(shapes).toHaveLength(7);
    expect(shapes.every((shape) => !shape.working)).toBe(true);
  });

  it("tri komada u danu se svode na prvi i poslednji", () => {
    // Forma zna za jednu pauzu; podatke koje ne ume da prikaže svede na
    // najbliži oblik umesto da ostane prazna.
    const [monday] = toDayShapes([
      { weekday: 1, startMinute: 540, endMinute: 660 },
      { weekday: 1, startMinute: 720, endMinute: 840 },
      { weekday: 1, startMinute: 900, endMinute: 1020 },
    ]);

    expect(monday).toMatchObject({
      startMinute: 540,
      endMinute: 1020,
      breakStartMinute: 660,
      breakEndMinute: 900,
    });
  });
});

describe("put tamo i nazad", () => {
  it("nedelja preživi pretvaranje u redove i nazad", () => {
    const week = defaultWeek().map((shape) =>
      shape.weekday === 1
        ? { ...shape, breakStartMinute: 13 * 60, breakEndMinute: 14 * 60 }
        : shape,
    );

    expect(toDayShapes(toIntervals(week))).toEqual(week);
  });
});
