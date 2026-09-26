import { describe, expect, it } from "vitest";
import {
  RELOAD_COOLDOWN_MS,
  isStaleBuildError,
  mayReloadAgain,
} from "@/lib/domain/stale-build";

describe("greška zastarele verzije", () => {
  it("prepoznaje oblike koje prave Turbopack, webpack i pregledači", () => {
    for (const message of [
      "Failed to load chunk /_next/static/chunks/8e8d03018498d646.js from module 64893",
      "Loading chunk 123 failed.",
      "Loading CSS chunk app-page failed.",
      "Importing a module script failed.",
      "Failed to fetch dynamically imported module: https://doterajme.rs/x.js",
    ]) {
      expect(isStaleBuildError({ message })).toBe(true);
    }
    expect(isStaleBuildError({ name: "ChunkLoadError", message: "" })).toBe(true);
  });

  it("obična greška nije zastarela verzija", () => {
    expect(
      isStaleBuildError({ message: "Cannot read properties of undefined" }),
    ).toBe(false);
  });
});

describe("zaštita od osvežavanja u krug", () => {
  it("prvi put sme", () => {
    expect(mayReloadAgain(null, 1_000_000)).toBe(true);
  });

  it("odmah posle osvežavanja ne sme", () => {
    expect(mayReloadAgain(1_000_000, 1_000_000 + 5_000)).toBe(false);
  });

  it("posle pauze ponovo sme — mogla je stići još jedna objava", () => {
    expect(mayReloadAgain(1_000_000, 1_000_000 + RELOAD_COOLDOWN_MS)).toBe(true);
  });
});
