import { describe, expect, it } from "vitest";
import {
  daysUntil,
  subscriptionState,
  DUE_SOON_DAYS,
} from "@/lib/domain/subscription";

const TODAY = "2026-09-15";

describe("stanje pretplate", () => {
  it("bez datuma se ne naplaćuje", () => {
    expect(subscriptionState(null, TODAY)).toBe("none");
    expect(subscriptionState("", TODAY)).toBe("none");
  });

  it("jučerašnji datum je istekao", () => {
    expect(subscriptionState("2026-09-14", TODAY)).toBe("overdue");
    expect(subscriptionState("2026-08-01", TODAY)).toBe("overdue");
  });

  it("današnji datum još važi", () => {
    // Salon plaćen do 15.09. radi celog 15.09., ne do 14.09.
    expect(subscriptionState(TODAY, TODAY)).toBe("due_soon");
  });

  it("narednih sedam dana je upozorenje", () => {
    expect(subscriptionState("2026-09-16", TODAY)).toBe("due_soon");
    expect(subscriptionState("2026-09-22", TODAY)).toBe("due_soon");
  });

  it("posle praga je mirno", () => {
    expect(subscriptionState("2026-09-23", TODAY)).toBe("active");
    expect(subscriptionState("2026-12-31", TODAY)).toBe("active");
  });

  it("prag se može pomeriti", () => {
    expect(subscriptionState("2026-09-18", TODAY, 2)).toBe("active");
    expect(subscriptionState("2026-09-17", TODAY, 2)).toBe("due_soon");
  });

  it("prelaz meseca i godine ne pomera prag", () => {
    expect(subscriptionState("2026-10-02", "2026-09-28")).toBe("due_soon");
    expect(subscriptionState("2027-01-02", "2026-12-29")).toBe("due_soon");
    expect(subscriptionState("2027-01-06", "2026-12-29")).toBe("active");
  });

  it("prag je stvarno sedam dana", () => {
    expect(DUE_SOON_DAYS).toBe(7);
  });
});

describe("broj preostalih dana", () => {
  it("broji unapred i unazad", () => {
    expect(daysUntil("2026-09-20", TODAY)).toBe(5);
    expect(daysUntil(TODAY, TODAY)).toBe(0);
    expect(daysUntil("2026-09-10", TODAY)).toBe(-5);
  });

  it("ne pomera se preko prelaska na zimsko računanje vremena", () => {
    // Srbija menja vreme 25.10.2026. Bez računanja u UTC-u bi ovde ispalo
    // 6.958… dana i zaokruživanje bi umelo da promaši.
    expect(daysUntil("2026-10-28", "2026-10-21")).toBe(7);
  });
});
