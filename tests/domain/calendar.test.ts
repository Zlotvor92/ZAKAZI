import { describe, expect, it } from "vitest";
import {
  addDays,
  buildWeekGrid,
  currentDateInTimeZone,
  isoWeekday,
  minutesToTime,
  startOfIsoWeek,
  timeToMinutes,
  type WorkingInterval,
} from "@/lib/domain/calendar";

const BELGRADE = "Europe/Belgrade";

/** Radno vreme kakvo pravi seed: podeljena smena pon–pet, subota u komadu. */
const SEED_WORKING_HOURS: WorkingInterval[] = [
  ...[1, 2, 3, 4, 5].flatMap((weekday) => [
    { weekday, startMinute: 9 * 60, endMinute: 13 * 60 },
    { weekday, startMinute: 16 * 60, endMinute: 20 * 60 },
  ]),
  { weekday: 6, startMinute: 9 * 60, endMinute: 14 * 60 },
];

describe("vreme kao minuti", () => {
  it("čita i ispisuje sate i minute", () => {
    expect(timeToMinutes("09:00")).toBe(540);
    expect(timeToMinutes("09:00:00")).toBe(540);
    expect(timeToMinutes("13:30")).toBe(810);
    expect(minutesToTime(540)).toBe("09:00");
    expect(minutesToTime(810)).toBe("13:30");
  });
});

describe("kalendarski datum u tajmzoni salona", () => {
  it("uzima dan po Beogradu, ne po UTC-u", () => {
    // 23:30 UTC u nedelju je već ponedeljak 01:30 u Beogradu.
    const now = new Date("2026-08-09T23:30:00Z");

    expect(currentDateInTimeZone(now, "UTC")).toBe("2026-08-09");
    expect(currentDateInTimeZone(now, BELGRADE)).toBe("2026-08-10");
  });

  it("po zimskom računanju vremena razlika je i dalje jedan sat", () => {
    const now = new Date("2026-01-11T23:30:00Z");

    expect(currentDateInTimeZone(now, "UTC")).toBe("2026-01-11");
    expect(currentDateInTimeZone(now, BELGRADE)).toBe("2026-01-12");
  });
});

describe("nedelja počinje u ponedeljak", () => {
  it("računa ISO dan u nedelji", () => {
    expect(isoWeekday("2026-08-10")).toBe(1);
    expect(isoWeekday("2026-08-15")).toBe(6);
    expect(isoWeekday("2026-08-16")).toBe(7);
  });

  it("vraća ponedeljak iz bilo kog dana te nedelje", () => {
    expect(startOfIsoWeek("2026-08-10")).toBe("2026-08-10");
    expect(startOfIsoWeek("2026-08-13")).toBe("2026-08-10");
    expect(startOfIsoWeek("2026-08-16")).toBe("2026-08-10");
    expect(startOfIsoWeek("2026-08-17")).toBe("2026-08-17");
  });

  it("prelazi preko granice meseca i godine", () => {
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(startOfIsoWeek("2026-01-01")).toBe("2025-12-29");
  });
});

describe("mreža nedelje", () => {
  it("ima sedam uzastopnih dana", () => {
    const grid = buildWeekGrid({
      weekStart: "2026-08-10",
      workingHours: SEED_WORKING_HOURS,
    });

    expect(grid.days.map((day) => day.date)).toEqual([
      "2026-08-10",
      "2026-08-11",
      "2026-08-12",
      "2026-08-13",
      "2026-08-14",
      "2026-08-15",
      "2026-08-16",
    ]);
    expect(grid.days.map((day) => day.weekday)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("granice mreže idu od najranijeg do najkasnijeg sata", () => {
    const grid = buildWeekGrid({
      weekStart: "2026-08-10",
      workingHours: SEED_WORKING_HOURS,
    });

    expect(minutesToTime(grid.startMinute)).toBe("09:00");
    expect(minutesToTime(grid.endMinute)).toBe("20:00");
    expect(grid.hourMarks).toHaveLength(12);
  });

  it("zaokružuje granice na pun sat", () => {
    const grid = buildWeekGrid({
      weekStart: "2026-08-10",
      workingHours: [{ weekday: 1, startMinute: 9 * 60 + 30, endMinute: 17 * 60 + 15 }],
    });

    expect(minutesToTime(grid.startMinute)).toBe("09:00");
    expect(minutesToTime(grid.endMinute)).toBe("18:00");
  });

  it("ponedeljak ima dva bloka sa pauzom između njih", () => {
    const grid = buildWeekGrid({
      weekStart: "2026-08-10",
      workingHours: SEED_WORKING_HOURS,
    });

    const monday = grid.days[0]!;
    expect(
      monday.intervals.map(
        (interval) =>
          `${minutesToTime(interval.startMinute)}-${minutesToTime(interval.endMinute)}`,
      ),
    ).toEqual(["09:00-13:00", "16:00-20:00"]);
  });

  it("subota je jedan blok, nedelja nema nijedan", () => {
    const grid = buildWeekGrid({
      weekStart: "2026-08-10",
      workingHours: SEED_WORKING_HOURS,
    });

    expect(grid.days[5]!.intervals).toEqual([
      { startMinute: 9 * 60, endMinute: 14 * 60 },
    ]);
    expect(grid.days[6]!.intervals).toEqual([]);
  });

  it("bez unetog radnog vremena mreža i dalje ima sedam dana", () => {
    const grid = buildWeekGrid({ weekStart: "2026-08-10", workingHours: [] });

    expect(grid.days).toHaveLength(7);
    expect(minutesToTime(grid.startMinute)).toBe("08:00");
    expect(minutesToTime(grid.endMinute)).toBe("20:00");
    expect(grid.days.every((day) => day.intervals.length === 0)).toBe(true);
  });
});

describe("nedelje sa prelaskom na drugo računanje vremena", () => {
  it("nedelja sa 23 sata i dalje ima sedam dana i iste satnice", () => {
    // 29.03.2026. Srbija prelazi na letnje vreme.
    const grid = buildWeekGrid({
      weekStart: "2026-03-23",
      workingHours: SEED_WORKING_HOURS,
    });

    expect(grid.days.map((day) => day.date)).toEqual([
      "2026-03-23",
      "2026-03-24",
      "2026-03-25",
      "2026-03-26",
      "2026-03-27",
      "2026-03-28",
      "2026-03-29",
    ]);
    expect(minutesToTime(grid.startMinute)).toBe("09:00");
    expect(minutesToTime(grid.endMinute)).toBe("20:00");
  });

  it("nedelja sa 25 sati se ponaša isto", () => {
    // 25.10.2026. Srbija prelazi na zimsko vreme.
    const grid = buildWeekGrid({
      weekStart: "2026-10-19",
      workingHours: SEED_WORKING_HOURS,
    });

    expect(grid.days.map((day) => day.date)).toEqual([
      "2026-10-19",
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
      "2026-10-24",
      "2026-10-25",
    ]);
    expect(grid.days[0]!.intervals[0]).toEqual({
      startMinute: 9 * 60,
      endMinute: 13 * 60,
    });
  });

  it("dan prelaska ne pomera nedelju kojoj pripada", () => {
    const springForward = new Date("2026-03-29T00:30:00Z");
    const date = currentDateInTimeZone(springForward, BELGRADE);

    expect(date).toBe("2026-03-29");
    expect(startOfIsoWeek(date)).toBe("2026-03-23");
  });
});
