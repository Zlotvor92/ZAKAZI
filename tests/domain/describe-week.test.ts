import { describe, expect, it } from "vitest";
import { describeWeek, emptyWeek, type DayShape } from "@/lib/domain/working-hours";

const NAMES = ["Pon", "Uto", "Sre", "Čet", "Pet", "Sub", "Ned"];

function week(patch: (day: DayShape) => Partial<DayShape>): DayShape[] {
  return emptyWeek().map((day) => ({ ...day, ...patch(day) }));
}

const SPLIT = {
  working: true,
  startMinute: 9 * 60,
  endMinute: 20 * 60,
  breakStartMinute: 12 * 60,
  breakEndMinute: 17 * 60,
};

describe("sažetak radnog vremena", () => {
  it("radni dani sa istim satima i pauzom se spajaju", () => {
    const days = week((day) => (day.weekday <= 5 ? SPLIT : {}));

    expect(describeWeek(days, NAMES)).toBe("Pon–Pet 09–12 i 17–20");
  });

  it("subota sa drugim satima ide posebno", () => {
    const days = week((day) =>
      day.weekday <= 5
        ? SPLIT
        : day.weekday === 6
          ? { working: true, startMinute: 9 * 60, endMinute: 14 * 60 }
          : {},
    );

    expect(describeWeek(days, NAMES)).toBe("Pon–Pet 09–12 i 17–20, Sub 09–14");
  });

  it("prekinut niz i dva dana zaredom se pišu odvojeno", () => {
    const days = week((day) =>
      [1, 2, 4].includes(day.weekday)
        ? { working: true, startMinute: 9 * 60, endMinute: 17 * 60 }
        : {},
    );

    expect(describeWeek(days, NAMES)).toBe("Pon, Uto 09–17, Čet 09–17");
  });

  it("minuti se pišu kad nisu pun sat", () => {
    const days = week((day) =>
      day.weekday === 6
        ? { working: true, startMinute: 9 * 60 + 30, endMinute: 14 * 60 }
        : {},
    );

    expect(describeWeek(days, NAMES)).toBe("Sub 09:30–14");
  });

  it("salon koji ne radi nijedan dan nema sažetak", () => {
    expect(describeWeek(emptyWeek(), NAMES)).toBeNull();
  });
});
