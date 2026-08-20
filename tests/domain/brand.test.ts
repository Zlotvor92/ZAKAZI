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
    // Smeće otpada i ostaje primarna boja — ali ona je na ovoj tamnoj kartici
    // tek 3.51, pa se posvetli taman toliko da se cena vidi. Ranije je ulazila
    // neizmenjena, i cena se nije čitala.
    expect(written).toContain("--brand-accent:#e95662");
  });

  it("nosi boje koje je salon izabrao", () => {
    const written = brandVariables(smiley)!;

    expect(written).toContain("--background:#0a0a0a");
    expect(written).toContain("--primary:#e11d2e");
    // Žuta se na tamnoj kartici vidi (10.2), pa ostaje netaknuta.
    expect(written).toContain("--brand-accent:#f5c518");
  });

  it("na tamnoj pozadini piše svetlim, na svetloj tamnim", () => {
    expect(brandVariables(smiley)).toContain("--foreground:#ffffff");
    expect(
      brandVariables({ ...smiley, background: "#fff5f5" }),
    ).toContain("--foreground:#000000");
  });

  // Ovo je provera koja je nedostajala. Ranije se biralo po pragu luminanse
  // od 0.35, pa je `#999999` dobijao svetao tekst sa odnosom 2.66 — ispod
  // 4.5 koliko WCAG AA traži. Prag je zamenjen merenjem, a ovaj test drži da
  // se ne vrati: ni glavni ni prigušen tekst ni cena ne smeju pasti ispod
  // praga, ni na jednoj pozadini koju salon sme da izabere.
  it("nijedna pozadina ne daje tekst ispod WCAG AA", () => {
    const luminance = (hex: string): number => {
      const channel = (from: number): number => {
        const value = Number.parseInt(hex.slice(from, from + 2), 16) / 255;
        return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
    };

    const contrast = (a: string, b: string): number => {
      const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (lighter! + 0.05) / (darker! + 0.05);
    };

    const read = (written: string, name: string): string =>
      new RegExp(`--${name}:(#[0-9a-f]{6})`).exec(written)![1]!;

    // Sivi klin pogađa svaki prag, a uz njega i boje koje salon stvarno bira.
    const pozadine = [
      ...Array.from({ length: 52 }, (_, i) =>
        `#${(i * 5).toString(16).padStart(2, "0").repeat(3)}`,
      ),
      "#ffd1dc", "#ffe4b5", "#b8860b", "#4d213c", "#2f4f4f", "#800020", "#00cc00",
    ];

    for (const background of pozadine) {
      const written = brandVariables({ ...smiley, background })!;
      const foreground = read(written, "foreground");

      // Glavni tekst na svojoj pozadini.
      expect(
        contrast(background, foreground),
        `glavni tekst na ${background}`,
      ).toBeGreaterThanOrEqual(4.5);

      // Prigušen tekst i cena na podlozi na kojoj stvarno stoje.
      for (const [tekst, podloga] of [
        ["muted-foreground", "muted"],
        ["brand-accent", "card"],
      ] as const) {
        expect(
          contrast(read(written, tekst), read(written, podloga)),
          `${tekst} na ${podloga}, pozadina ${background}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("veliko slovo u heksu je i dalje ista boja", () => {
    expect(brandVariables({ ...smiley, primary: "#E11D2E" })).toContain(
      "--primary:#e11d2e",
    );
  });
});
