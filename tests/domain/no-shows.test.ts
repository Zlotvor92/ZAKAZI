import { describe, expect, it } from "vitest";
import { priorNoShowsLine } from "@/lib/domain/no-shows";

describe("linija o ranijim izostancima", () => {
  it("bez izostanaka nema linije", () => {
    expect(priorNoShowsLine({ total: 0, latest: [] }, "Europe/Belgrade")).toBeNull();
  });

  it("navodi broj, dan, sat i uslugu, po vremenu salona", () => {
    expect(
      priorNoShowsLine(
        {
          total: 4,
          latest: [
            { start_at: "2026-09-12T12:00:00Z", service_name: "Gel nokti" },
            { start_at: "2026-03-02T13:30:00Z", service_name: "Pedikir" },
          ],
        },
        "Europe/Belgrade",
      ),
    ).toBe(
      "Ranije nije došla 4×: 12.09. u 14:00 (Gel nokti), 02.03. u 14:30 (Pedikir)",
    );
  });
});
