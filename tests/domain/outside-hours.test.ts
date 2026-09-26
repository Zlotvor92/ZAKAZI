import { describe, expect, it } from "vitest";
import { outsideHoursMessage } from "@/lib/domain/outside-hours";

const TZ = "Europe/Belgrade";
const entry = (start_at: string, client_name: string) => ({ start_at, client_name });

describe("poruka o terminima van radnog vremena", () => {
  it("bez takvih termina nema poruke", () => {
    expect(outsideHoursMessage([], TZ)).toBeNull();
  });

  it("jedan termin, po satu salona", () => {
    expect(outsideHoursMessage([entry("2026-09-30T08:00:00Z", "Ana")], TZ)).toBe(
      "Sačuvano. Van novog radnog vremena ostaje 1 zakazan termin: sre 30.9. u 10:00 (Ana). Termini nisu otkazani — javi klijentkinjama ako treba.",
    );
  });

  it("paukal i množina se slažu sa brojem", () => {
    const two = outsideHoursMessage(
      [entry("2026-09-30T08:00:00Z", "Ana"), entry("2026-09-30T09:00:00Z", "Mila")],
      TZ,
    );
    expect(two).toContain("ostaju 2 zakazana termina");

    const five = outsideHoursMessage(
      Array.from({ length: 5 }, (_, index) =>
        entry(`2026-10-0${index + 1}T08:00:00Z`, `K${index}`),
      ),
      TZ,
    );
    expect(five).toContain("ostaje 5 zakazanih termina");
    expect(five).toContain("(K2), i još 2.");
  });
});
