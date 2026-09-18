import { describe, expect, it } from "vitest";
import { timeOffOfDay, type TimeOffRange } from "@/lib/domain/time-off";

const BELGRADE = "Europe/Belgrade";

function range(
  id: string,
  startAt: string,
  endAt: string,
  reason: string | null = null,
): TimeOffRange {
  return { id, start_at: startAt, end_at: endAt, reason };
}

describe("odsustvo u danu", () => {
  it("deo dana ostaje kako je upisan", () => {
    const rows = timeOffOfDay(
      [range("a", "2026-09-21T07:00:00Z", "2026-09-21T08:30:00Z", "lekar")],
      "2026-09-21",
      BELGRADE,
    );

    expect(rows).toEqual([
      {
        id: "a",
        startAt: "2026-09-21T07:00:00.000Z",
        endAt: "2026-09-21T08:30:00.000Z",
        wholeDay: false,
        reason: "lekar",
      },
    ]);
  });

  it("ceo dan se prepoznaje kao ceo dan", () => {
    const rows = timeOffOfDay(
      [range("a", "2026-09-20T22:00:00Z", "2026-09-21T22:00:00Z")],
      "2026-09-21",
      BELGRADE,
    );

    expect(rows[0]!.wholeDay).toBe(true);
  });

  it("odsustvo preko više dana se seče na granice dana", () => {
    const week = range("a", "2026-09-18T12:00:00Z", "2026-09-21T07:00:00Z");

    // Petak: od podne do ponoći po Beogradu.
    const friday = timeOffOfDay([week], "2026-09-18", BELGRADE)[0]!;
    expect(friday.startAt).toBe("2026-09-18T12:00:00.000Z");
    expect(friday.endAt).toBe("2026-09-18T22:00:00.000Z");
    expect(friday.wholeDay).toBe(false);

    // Subota: cela.
    expect(timeOffOfDay([week], "2026-09-19", BELGRADE)[0]!.wholeDay).toBe(true);

    // Ponedeljak: od ponoći do devet.
    const monday = timeOffOfDay([week], "2026-09-21", BELGRADE)[0]!;
    expect(monday.startAt).toBe("2026-09-20T22:00:00.000Z");
    expect(monday.endAt).toBe("2026-09-21T07:00:00.000Z");
  });

  it("dan bez odsustva ne dobija nijedan red", () => {
    const rows = timeOffOfDay(
      [range("a", "2026-09-21T07:00:00Z", "2026-09-21T08:30:00Z")],
      "2026-09-22",
      BELGRADE,
    );

    expect(rows).toEqual([]);
  });

  it("odsustvo koje se završava tačno u ponoć ne ulazi u sledeći dan", () => {
    const rows = timeOffOfDay(
      [range("a", "2026-09-21T12:00:00Z", "2026-09-21T22:00:00Z")],
      "2026-09-22",
      BELGRADE,
    );

    expect(rows).toEqual([]);
  });

  it("dan prelaska na zimsko vreme traje 25 sati", () => {
    // 25. oktobra 2026. Srbija vraća sat: dan po Beogradu ide od 22:00 UTC
    // prethodnog dana do 23:00 UTC istog. Odsustvo koje pokriva tih 25 sati je
    // ceo dan; jedan sat manje nije.
    const whole = range("a", "2026-10-24T22:00:00Z", "2026-10-25T23:00:00Z");
    expect(timeOffOfDay([whole], "2026-10-25", BELGRADE)[0]!.wholeDay).toBe(
      true,
    );

    const short = range("b", "2026-10-24T22:00:00Z", "2026-10-25T22:00:00Z");
    const row = timeOffOfDay([short], "2026-10-25", BELGRADE)[0]!;
    expect(row.wholeDay).toBe(false);
    expect(row.endAt).toBe("2026-10-25T22:00:00.000Z");
  });

  it("više odsustava istog dana ide po vremenu", () => {
    const rows = timeOffOfDay(
      [
        range("posle", "2026-09-21T12:00:00Z", "2026-09-21T13:00:00Z"),
        range("pre", "2026-09-21T07:00:00Z", "2026-09-21T08:00:00Z"),
      ],
      "2026-09-21",
      BELGRADE,
    );

    expect(rows.map((row) => row.id)).toEqual(["pre", "posle"]);
  });
});
