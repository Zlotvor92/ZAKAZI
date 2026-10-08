import { describe, expect, it } from "vitest";
import { cspReportMessage, stripUrl } from "@/lib/domain/csp-report";

describe("stripUrl", () => {
  it("odbacuje upit i fragment", () => {
    expect(stripUrl("https://doterajme.rs/salon?telefon=064123&x=1#a")).toBe(
      "https://doterajme.rs/salon",
    );
  });

  it("sakriva token kalendara u putanji", () => {
    expect(
      stripUrl("https://doterajme.rs/api/kalendar/salon/TAJNI-TOKEN.ics"),
    ).toBe("https://doterajme.rs/api/kalendar/salon/[token].ics");
  });

  it.each([
    ["inline", "inline"],
    ["eval", "eval"],
    ["data", "data"],
  ])("šeme koje nisu adresa ostaju: %s", (value, expected) => {
    expect(stripUrl(value)).toBe(expected);
  });

  it.each([undefined, null, 5, ""])("prazno i neispravno: %j", (value) => {
    expect(stripUrl(value)).toBe("-");
  });
});

describe("cspReportMessage", () => {
  it("nosi pravilo, izvor blokiranog i stranu, bez upita", () => {
    const message = cspReportMessage({
      "violated-directive": "img-src",
      "blocked-uri": "https://tudj.example/slika.png?korisnik=jelena",
      "document-uri": "https://doterajme.rs/studio-milica?telefon=0641234567",
    });

    expect(message).toBe(
      "CSP img-src: blokirano https://tudj.example/slika.png na https://doterajme.rs/studio-milica",
    );
    expect(message).not.toContain("jelena");
    expect(message).not.toContain("0641234567");
  });

  it("prihvata i novi oblik izveštaja", () => {
    expect(
      cspReportMessage({
        effectiveDirective: "script-src-elem",
        "effective-directive": "script-src-elem",
        blockedURL: "https://cdn.example/x.js",
        documentURL: "https://doterajme.rs/",
      }),
    ).toContain("script-src-elem");
  });

  it("nikad duže od 500 znakova", () => {
    expect(
      cspReportMessage({ "violated-directive": "x".repeat(2000) }).length,
    ).toBeLessThanOrEqual(500);
  });
});
