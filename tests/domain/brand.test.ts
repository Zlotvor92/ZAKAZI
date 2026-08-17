import { describe, expect, it } from "vitest";
import { brandVariables, isDark } from "@/lib/domain/brand";

const smiley = {
  background: "#0a0a0a",
  primary: "#e11d2e",
  accent: "#f5c518",
};

describe("koje je pozadine salon", () => {
  it("crna je tamna, bela nije", () => {
    expect(isDark("#0a0a0a")).toBe(true);
    expect(isDark("#ffffff")).toBe(false);
  });

  it("zelena je svetlija nego što izgleda", () => {
    // Oko je najosetljivije na zeleno; po sirovoj vrednosti bi #00cc00 delovao
    // taman, pa se luminansa mora meriti, ne pogađati.
    expect(isDark("#00cc00")).toBe(false);
    expect(isDark("#0000cc")).toBe(true);
  });
});

describe("boje salona kao promenljive", () => {
  it("salon bez izabranih boja ostaje na podrazumevanom", () => {
    expect(
      brandVariables({ background: null, primary: null, accent: null }),
    ).toBeNull();
  });

  it("nepotpun izbor ne pravi pola teme", () => {
    expect(
      brandVariables({ background: "#0a0a0a", primary: null, accent: null }),
    ).toBeNull();
  });

  it("smeće se odbacuje umesto da uđe u stranicu", () => {
    // Vrednost završava u `<style>` tagu, pa ovo nije stvar lepote.
    expect(
      brandVariables({
        background: "#0a0a0a;} body{display:none",
        primary: "#e11d2e",
        accent: null,
      }),
    ).toBeNull();

    const written = brandVariables({
      ...smiley,
      accent: "javascript:alert(1)",
    });
    expect(written).not.toContain("javascript");
    expect(written).toContain("--brand-accent:#e11d2e");
  });

  it("nosi boje koje je salon izabrao", () => {
    const written = brandVariables(smiley)!;

    expect(written).toContain("--background:#0a0a0a");
    expect(written).toContain("--primary:#e11d2e");
    expect(written).toContain("--brand-accent:#f5c518");
  });

  it("na tamnoj pozadini piše svetlim, na svetloj tamnim", () => {
    expect(brandVariables(smiley)).toContain("--foreground:#f7f7f7");
    expect(
      brandVariables({ ...smiley, background: "#fff5f5" }),
    ).toContain("--foreground:#141414");
  });

  it("veliko slovo u heksu je i dalje ista boja", () => {
    expect(brandVariables({ ...smiley, primary: "#E11D2E" })).toContain(
      "--primary:#e11d2e",
    );
  });
});
