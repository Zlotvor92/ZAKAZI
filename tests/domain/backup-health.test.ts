import { describe, expect, it } from "vitest";
import {
  backupState,
  hoursSince,
  STALE_AFTER_HOURS,
} from "@/lib/domain/backup-health";

const NOW = new Date("2026-08-19T09:00:00Z");

/** Prolaz koji je počeo pre `hours` sati. */
function ranHoursAgo(hours: number, conclusion: string | null = "success") {
  return {
    conclusion,
    startedAt: new Date(NOW.getTime() - hours * 3_600_000).toISOString(),
  };
}

describe("stanje kopije baze", () => {
  it("sveža uspešna kopija je u redu", () => {
    expect(backupState(ranHoursAgo(6), NOW)).toBe("ok");
    expect(backupState(ranHoursAgo(0), NOW)).toBe("ok");
  });

  it("pad se javlja", () => {
    expect(backupState(ranHoursAgo(2, "failure"), NOW)).toBe("failed");
    expect(backupState(ranHoursAgo(2, "cancelled"), NOW)).toBe("failed");
    expect(backupState(ranHoursAgo(2, "timed_out"), NOW)).toBe("failed");
  });

  it("pad ostaje pad i kad je star, jer se on popravlja", () => {
    expect(backupState(ranHoursAgo(200, "failure"), NOW)).toBe("failed");
  });

  it("prolaz u toku se ne javlja", () => {
    expect(backupState(ranHoursAgo(0, null), NOW)).toBe("running");
  });

  it("prolaz koji traje danima je zaglavljen, ne u toku", () => {
    expect(backupState(ranHoursAgo(200, null), NOW)).toBe("stale");
  });

  // Ovo je slučaj zbog kog provera i postoji: ničega nema, a greške nema jer
  // posao nije ni pokušan.
  it("uspešna ali prestara kopija znači da posao ćuti", () => {
    expect(backupState(ranHoursAgo(STALE_AFTER_HOURS + 1), NOW)).toBe("stale");
    expect(backupState(ranHoursAgo(24 * 30), NOW)).toBe("stale");
  });

  it("granica se ne prelazi ranije nego što treba", () => {
    expect(backupState(ranHoursAgo(STALE_AFTER_HOURS - 1), NOW)).toBe("ok");
  });

  it("prag se može pomeriti", () => {
    expect(backupState(ranHoursAgo(10), NOW, 8)).toBe("stale");
    expect(backupState(ranHoursAgo(10), NOW, 12)).toBe("ok");
  });

  it("bez podatka se ne izmišlja da je sve u redu", () => {
    expect(backupState(null, NOW)).toBe("unknown");
    expect(backupState({ conclusion: "success", startedAt: "" }, NOW)).toBe(
      "unknown",
    );
    expect(
      backupState({ conclusion: "success", startedAt: "juče" }, NOW),
    ).toBe("unknown");
  });
});

describe("starost kopije", () => {
  it("broji pune sate", () => {
    expect(hoursSince(ranHoursAgo(5), NOW)).toBe(5);
    expect(hoursSince(ranHoursAgo(49), NOW)).toBe(49);
  });
});
