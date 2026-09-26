import { describe, expect, it } from "vitest";
import {
  serviceLine,
  serviceRules,
  type SummarizedService,
} from "@/lib/domain/service-summary";

function service(patch: Partial<SummarizedService>): SummarizedService {
  return {
    id: "x",
    name: "Usluga",
    duration_min: 90,
    price_rsd: 0,
    requires_service_id: null,
    requires_within_days: null,
    not_after_service_id: null,
    not_after_instead_service_id: null,
    ...patch,
  };
}

const fullSet = service({ id: "full", name: "Nadogradnja trepavica" });
const removal = service({ id: "off", name: "Skidanje trepavica" });

describe("red usluge u spisku", () => {
  it("trajanje u satima i minutima, cena sa tačkom za hiljade", () => {
    expect(serviceLine(service({ duration_min: 90, price_rsd: 2200 }))).toBe(
      "1 h 30 min · 2.200 RSD",
    );
  });

  it("bez cene samo trajanje", () => {
    expect(serviceLine(service({ duration_min: 30 }))).toBe("30 min");
    expect(serviceLine(service({ duration_min: 120 }))).toBe("2 h");
  });
});

describe("pravila usluge kao rečenice", () => {
  it("rok i redosled, nazivima iz salona", () => {
    const refill = service({
      id: "refill",
      requires_service_id: "full",
      requires_within_days: 21,
      not_after_service_id: "off",
      not_after_instead_service_id: "full",
    });

    expect(serviceRules(refill, [fullSet, removal, refill])).toEqual([
      "Rok 21 dan od: Nadogradnja trepavica",
      "Ne posle: Skidanje trepavica → Nadogradnja trepavica",
    ]);
  });

  it("usluga bez pravila nema rečenica", () => {
    expect(serviceRules(fullSet, [fullSet, removal])).toEqual([]);
  });

  it("pravilo koje pokazuje na uklonjenu uslugu se ne navodi", () => {
    const refill = service({
      id: "refill",
      not_after_service_id: "off",
      not_after_instead_service_id: "full",
    });

    expect(serviceRules(refill, [removal, refill])).toEqual([]);
  });
});
