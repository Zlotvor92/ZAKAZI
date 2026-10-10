import { describe, expect, it } from "vitest";
import { sr } from "@/lib/i18n/sr";

describe("poruka blokiranom broju", () => {
  it("ne razlikuje se od obične greške pri zakazivanju", () => {
    expect(sr.booking.rejected.blocked).toBe(sr.booking.failed);
  });
});
