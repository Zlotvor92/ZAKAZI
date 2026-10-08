import { describe, expect, it } from "vitest";
import { dashboardLink } from "@/lib/domain/dashboard-link";
import {
  isRefreshMessage,
  REFRESH_AFTER_AWAY_MS,
  shouldRefreshAfterAbsence,
} from "@/lib/domain/live-refresh";

describe("shouldRefreshAfterAbsence", () => {
  it("kratko prebacivanje između aplikacija ne osvežava", () => {
    expect(shouldRefreshAfterAbsence(2_000)).toBe(false);
    expect(shouldRefreshAfterAbsence(REFRESH_AFTER_AWAY_MS - 1)).toBe(false);
  });

  it("duža pauza osvežava", () => {
    expect(shouldRefreshAfterAbsence(REFRESH_AFTER_AWAY_MS)).toBe(true);
    expect(shouldRefreshAfterAbsence(60 * 60 * 1000)).toBe(true);
  });
});

describe("isRefreshMessage", () => {
  it("prepoznaje poruku servisnog radnika", () => {
    expect(isRefreshMessage({ type: "refresh" })).toBe(true);
  });

  it.each([null, undefined, "refresh", 1, {}, { type: "other" }])(
    "ignoriše sve ostalo: %j",
    (data) => {
      expect(isRefreshMessage(data)).toBe(false);
    },
  );
});

describe("dashboardLink", () => {
  it("nosi i salon i dan", () => {
    expect(
      dashboardLink({
        tenantId: "9a7b4c11-1f0d-4d1a-8d36-2e7c7f2a5e44",
        day: "2026-10-25",
      }),
    ).toBe(
      "/dashboard/otvori?salon=9a7b4c11-1f0d-4d1a-8d36-2e7c7f2a5e44&dan=2026-10-25",
    );
  });
});
