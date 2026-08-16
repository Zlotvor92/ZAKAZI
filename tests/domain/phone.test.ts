import { describe, expect, it } from "vitest";
import { normalizePhone, type PhoneProblem } from "@/lib/domain/phone";

function e164(input: string): string {
  const result = normalizePhone(input);
  if (!result.ok) {
    throw new Error(`Očekivan ispravan broj, dobijeno: ${result.reason}`);
  }
  return result.e164;
}

function problem(input: string): PhoneProblem {
  const result = normalizePhone(input);
  if (result.ok) {
    throw new Error(`Očekivana greška, dobijeno: ${result.e164}`);
  }
  return result.reason;
}

describe("domaći mobilni broj", () => {
  it("odbacuje nulu ispred i dodaje pozivni broj", () => {
    expect(e164("0641234567")).toBe("+381641234567");
  });

  it("ne mari kako je broj razmaknut", () => {
    const expected = "+381641234567";

    expect(e164("064 123 4567")).toBe(expected);
    expect(e164("064/123-4567")).toBe(expected);
    expect(e164("064.123.4567")).toBe(expected);
    expect(e164("(064) 123 4567")).toBe(expected);
    expect(e164("  0641234567  ")).toBe(expected);
  });

  it("prihvata sve načine na koje se piše pozivni broj", () => {
    const expected = "+381641234567";

    expect(e164("+381641234567")).toBe(expected);
    expect(e164("+381 64 123 4567")).toBe(expected);
    expect(e164("00381641234567")).toBe(expected);
    expect(e164("381641234567")).toBe(expected);
  });

  it("prihvata broj bez nule ispred", () => {
    expect(e164("641234567")).toBe("+381641234567");
  });

  it("guta nulu zaostalu iza pozivnog broja", () => {
    // Čest previd: broj se prepiše iz imenika a pozivni doda ispred njega.
    expect(e164("+3810641234567")).toBe("+381641234567");
    expect(e164("00381 064 123 4567")).toBe("+381641234567");
  });

  it("prihvata i kraći oblik od osam cifara", () => {
    expect(e164("064123456")).toBe("+38164123456");
  });
});

describe("domaći fiksni broj", () => {
  it("beogradski broj prolazi isto kao mobilni", () => {
    expect(e164("011 2345678")).toBe("+381112345678");
  });

  it("novosadski broj prolazi", () => {
    expect(e164("021 456789")).toBe("+38121456789");
  });
});

describe("strani broj", () => {
  it("prolazi ako nosi plus", () => {
    expect(e164("+49 151 12345678")).toBe("+4915112345678");
    expect(e164("+387 61 123 456")).toBe("+38761123456");
    expect(e164("+382 67 123 456")).toBe("+38267123456");
  });

  it("bez plusa se čita kao domaći i ispadne predugačak", () => {
    // Namerno: podrazumevana zemlja je Srbija, pa je odbijanje ovde poštenije
    // od tihog pogađanja koja je zemlja u pitanju.
    expect(problem("4915112345678")).toBe("too_long");
  });
});

describe("broj koji ne valja", () => {
  it("prazno polje", () => {
    expect(problem("")).toBe("empty");
    expect(problem("   ")).toBe("empty");
  });

  it("slova nisu broj", () => {
    expect(problem("zovi me")).toBe("not_a_number");
    expect(problem("064abc4567")).toBe("not_a_number");
    expect(problem("+")).toBe("not_a_number");
    expect(problem("---")).toBe("not_a_number");
  });

  it("plus sme samo na početku", () => {
    expect(problem("064+1234567")).toBe("not_a_number");
  });

  it("nula ne sme da bude prva cifra međunarodnog broja", () => {
    expect(problem("+0641234567")).toBe("not_a_number");
  });

  it("prekratak domaći broj", () => {
    expect(problem("064123")).toBe("too_short");
    expect(problem("0641234")).toBe("too_short");
  });

  it("predugačak domaći broj", () => {
    expect(problem("06412345678")).toBe("too_long");
  });

  it("prekratak strani broj", () => {
    expect(problem("+1234")).toBe("too_short");
  });

  it("predugačak strani broj", () => {
    expect(problem("+491511234567890123")).toBe("too_long");
  });
});

describe("normalizacija je stabilna", () => {
  it("isti broj napisan na pet načina daje jedan zapis", () => {
    const written = [
      "0641234567",
      "064 123 4567",
      "064/123-4567",
      "+381641234567",
      "00381641234567",
    ];

    const normalized = new Set(written.map(e164));

    expect(normalized).toEqual(new Set(["+381641234567"]));
  });

  it("propušten kroz sebe drugi put ne menja ništa", () => {
    const once = e164("064 123 4567");

    expect(e164(once)).toBe(once);
  });
});
