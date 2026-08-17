import { describe, expect, it } from "vitest";
import {
  addDays,
  currentDateInTimeZone,
  dayBoundsInTimeZone,
  instantInTimeZone,
  isoWeekDates,
  isoWeekday,
  minutesToTime,
  startOfIsoWeek,
  timeToMinutes,
} from "@/lib/domain/calendar";

const BELGRADE = "Europe/Belgrade";

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

describe("sedam dana nedelje", () => {
  it("uvek počinje ponedeljkom, ma koji dan bio zadat", () => {
    expect(isoWeekDates("2026-08-13")).toEqual([
      "2026-08-10",
      "2026-08-11",
      "2026-08-12",
      "2026-08-13",
      "2026-08-14",
      "2026-08-15",
      "2026-08-16",
    ]);
  });

  it("nedelja je poslednji dan svoje nedelje, ne prvi", () => {
    expect(isoWeekDates("2026-08-16")[0]).toBe("2026-08-10");
    expect(isoWeekDates("2026-08-16").at(-1)).toBe("2026-08-16");
  });

  it("nedelja koja preseca godinu ostaje cela", () => {
    expect(isoWeekDates("2026-01-01")).toHaveLength(7);
    expect(isoWeekDates("2026-01-01")[0]).toBe("2025-12-29");
  });
});

describe("zidno vreme salona kao trenutak", () => {
  it("leti je pomeraj dva sata, zimi jedan", () => {
    expect(instantInTimeZone("2026-08-10", 9 * 60, BELGRADE).toISOString()).toBe(
      "2026-08-10T07:00:00.000Z",
    );
    expect(instantInTimeZone("2026-01-12", 9 * 60, BELGRADE).toISOString()).toBe(
      "2026-01-12T08:00:00.000Z",
    );
  });

  it("na dan prelaska 09:00 je i dalje 09:00 po Beogradu", () => {
    expect(instantInTimeZone("2026-10-25", 9 * 60, BELGRADE).toISOString()).toBe(
      "2026-10-25T08:00:00.000Z",
    );
    expect(instantInTimeZone("2026-10-24", 9 * 60, BELGRADE).toISOString()).toBe(
      "2026-10-24T07:00:00.000Z",
    );
  });

  it("ponoć na kraju dana pripada sledećem datumu", () => {
    expect(instantInTimeZone("2026-08-10", 24 * 60, BELGRADE).toISOString()).toBe(
      "2026-08-10T22:00:00.000Z",
    );
  });
});

describe("granice dana po satu salona", () => {
  it("dan traje od ponoći do ponoći po Beogradu", () => {
    const bounds = dayBoundsInTimeZone("2026-08-10", BELGRADE);

    expect(bounds.from.toISOString()).toBe("2026-08-09T22:00:00.000Z");
    expect(bounds.to.toISOString()).toBe("2026-08-10T22:00:00.000Z");
  });

  it("dan prelaska na zimsko vreme ima dvadeset pet sati", () => {
    const bounds = dayBoundsInTimeZone("2026-10-25", BELGRADE);
    const hours =
      (bounds.to.getTime() - bounds.from.getTime()) / (60 * 60 * 1000);

    expect(hours).toBe(25);
  });

  it("dan prelaska na letnje vreme ima dvadeset tri sata", () => {
    const bounds = dayBoundsInTimeZone("2026-03-29", BELGRADE);
    const hours =
      (bounds.to.getTime() - bounds.from.getTime()) / (60 * 60 * 1000);

    expect(hours).toBe(23);
  });
});
