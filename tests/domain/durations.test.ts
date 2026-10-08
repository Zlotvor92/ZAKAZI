import { describe, expect, it } from "vitest";
import { COMMON_DURATIONS, durationOptions } from "@/lib/domain/durations";

describe("durationOptions", () => {
  it("bez dodatnih trajanja daje uobičajena, po redu", () => {
    expect(durationOptions([])).toEqual([...COMMON_DURATIONS]);
  });

  it.each([20, 75, 105])("dodaje trajanje usluge koje nije na spisku: %i", (minutes) => {
    const options = durationOptions([minutes]);

    expect(options).toContain(minutes);
    expect(options).toEqual([...options].sort((a, b) => a - b));
  });

  it("ne dupli trajanja koja već postoje", () => {
    expect(durationOptions([60, 60, 90])).toEqual([...COMMON_DURATIONS]);
  });

  it("izbacuje vrednosti koje nisu pozitivni celi brojevi", () => {
    expect(durationOptions([0, -15, 12.5, Number.NaN])).toEqual([
      ...COMMON_DURATIONS,
    ]);
  });
});
