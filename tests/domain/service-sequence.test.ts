import { describe, expect, it } from "vitest";
import { sequenceMessage } from "@/lib/domain/service-sequence";

const after = {
  kind: "after" as const,
  service_name: "Korekcija trepavica",
  blocking_service_name: "Skidanje trepavica",
  blocking_at: "2026-10-09T16:30:00Z",
  required_service_name: "Nadogradnja trepavica",
};

const before = {
  kind: "before" as const,
  service_name: "Skidanje trepavica",
  later_service_name: "Korekcija trepavica",
  later_at: "2026-10-10T08:30:00Z",
};

describe("poruka o redosledu usluga", () => {
  it("klijentkinji: korekcija posle skidanja šalje na nadogradnju", () => {
    expect(sequenceMessage(after, "Europe/Belgrade", "client")).toBe(
      "Usluga „Korekcija trepavica“ nije moguća posle usluge „Skidanje trepavica“ (9. oktobar). Izaberi „Nadogradnja trepavica“.",
    );
  });

  it("klijentkinji: skidanje pred zakazanu korekciju traži da je prvo otkaže", () => {
    expect(sequenceMessage(before, "Europe/Belgrade", "client")).toBe(
      "Već imaš zakazanu uslugu „Korekcija trepavica“ za 10. oktobar. Posle usluge „Skidanje trepavica“ ona nije moguća. Prvo je otkaži, pa zakaži ponovo.",
    );
  });

  it("vlasnici: isti podaci, upozorenje umesto zabrane", () => {
    expect(sequenceMessage(after, "Europe/Belgrade", "owner")).toBe(
      "Klijentkinja ima „Skidanje trepavica“ (9. oktobar) pre ove usluge — po pravilu sada ide „Nadogradnja trepavica“.",
    );
    expect(sequenceMessage(before, "Europe/Belgrade", "owner")).toBe(
      "Klijentkinja već ima zakazanu „Korekcija trepavica“ za 10. oktobar — posle „Skidanje trepavica“ ona nije moguća.",
    );
  });

  it("datum je po satu salona, ne po UTC-u", () => {
    const lateNight = { ...after, blocking_at: "2026-10-31T23:30:00Z" };

    expect(sequenceMessage(lateNight, "Europe/Belgrade", "client")).toContain(
      "(1. novembar)",
    );
  });
});
