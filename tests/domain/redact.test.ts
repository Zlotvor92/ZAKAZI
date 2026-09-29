import { describe, expect, it } from "vitest";
import { redactErrorPath } from "@/lib/domain/redact";

describe("redactErrorPath", () => {
  it("token kalendara postaje [token], .ics ostaje", () => {
    expect(
      redactErrorPath("/api/kalendar/salon/6f1c3a52-0a9e-4a2e-9f0e-0d5b4c1f7a11.ics"),
    ).toBe("/api/kalendar/salon/[token].ics");
  });

  it("goli token bez nastavka", () => {
    expect(redactErrorPath("/api/kalendar/salon/abc")).toBe("/api/kalendar/salon/[token]");
  });

  it("ostale putanje se ne diraju", () => {
    expect(redactErrorPath("/dashboard/podesavanja")).toBe("/dashboard/podesavanja");
    expect(redactErrorPath("/api/kalendar")).toBe("/api/kalendar");
  });

  it("null ostaje null", () => {
    expect(redactErrorPath(null)).toBeNull();
    expect(redactErrorPath(undefined)).toBeNull();
  });
});
