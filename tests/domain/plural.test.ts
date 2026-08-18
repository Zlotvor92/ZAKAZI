import { describe, expect, it } from "vitest";
import { pluralize, type PluralForms } from "@/lib/domain/plural";

const USLUGA: PluralForms = ["usluga", "usluge", "usluga"];
const TERMIN: PluralForms = ["termin", "termina", "termina"];

describe("srpska množina", () => {
  it("jednina za brojeve koji se završavaju jedinicom", () => {
    for (const n of [1, 21, 31, 101, 1001]) {
      expect({ n, form: pluralize(n, USLUGA) }).toEqual({ n, form: "usluga" });
      expect({ n, form: pluralize(n, TERMIN) }).toEqual({ n, form: "termin" });
    }
  });

  it("paukal za dva, tri i četiri", () => {
    for (const n of [2, 3, 4, 22, 33, 44, 104]) {
      expect({ n, form: pluralize(n, USLUGA) }).toEqual({ n, form: "usluge" });
      expect({ n, form: pluralize(n, TERMIN) }).toEqual({ n, form: "termina" });
    }
  });

  it("množina za pet i naviše", () => {
    for (const n of [5, 6, 9, 25, 100, 105]) {
      expect({ n, form: pluralize(n, USLUGA) }).toEqual({ n, form: "usluga" });
      expect({ n, form: pluralize(n, TERMIN) }).toEqual({ n, form: "termina" });
    }
  });

  it("jedanaest do četrnaest idu u množinu, ne u jedninu ni paukal", () => {
    // Poenta pravila: `11 % 10` je 1, ali se ne kaže „11 usluga" po jednini.
    for (const n of [11, 12, 13, 14, 111, 112, 113, 114]) {
      expect({ n, form: pluralize(n, USLUGA) }).toEqual({ n, form: "usluga" });
      expect({ n, form: pluralize(n, TERMIN) }).toEqual({ n, form: "termina" });
    }
  });

  it("nula ide u množinu", () => {
    expect(pluralize(0, USLUGA)).toBe("usluga");
    expect(pluralize(0, TERMIN)).toBe("termina");
  });
});
