import { afterAll, describe, expect, it } from "vitest";
import { normalizePhone } from "@/lib/domain/phone";
import { closePool, withRollback } from "./helpers";

afterAll(closePool);

/** Brojevi koji izgledaju izmišljeno i oni koji ne izgledaju. */
const FAKE = [
  "+381641111111",
  "+381640000000",
  "+381641234567",
  "+381647654321",
  "+381111111111",
  "+11111111111",
];

const REAL = [
  "+381645123480",
  "+381641155990",
  "+381642211334",
  "+38164123456",
  "+38121456789",
  "+381113456781",
  "+4915112345678",
];

async function fakeInDatabase(
  db: Parameters<Parameters<typeof withRollback>[0]>[0],
  phone: string,
): Promise<boolean> {
  const result = await db.query<{ fake: boolean }>(
    "select phone_looks_fake($1) as fake",
    [phone],
  );
  return result.rows[0]!.fake;
}

describe("izmišljen broj u bazi", () => {
  it("prepoznaje izmišljene", async () => {
    await withRollback(async (db) => {
      for (const phone of FAKE) {
        expect({ phone, fake: await fakeInDatabase(db, phone) }).toEqual({
          phone,
          fake: true,
        });
      }
    });
  });

  it("pušta stvarne", async () => {
    await withRollback(async (db) => {
      for (const phone of REAL) {
        expect({ phone, fake: await fakeInDatabase(db, phone) }).toEqual({
          phone,
          fake: false,
        });
      }
    });
  });

  it("baza i forma govore isto", async () => {
    // Ovo je poenta ovog fajla. Provera na formi služi lepšoj poruci, a baza
    // brani — ali samo dok obe kažu isto. Ako neko promeni jednu, ovaj test
    // pukne pre nego što razlika stigne na produkciju.
    //
    // Strani brojevi su izuzeti: forma ih odbija razlogom `foreign`, pre nego
    // što uopšte stigne do provere obrasca cifara — to poređenje pripada
    // testu za strane brojeve, ne ovom.
    await withRollback(async (db) => {
      const domestic = [...FAKE, ...REAL].filter((phone) =>
        phone.startsWith("+381"),
      );

      for (const phone of domestic) {
        const inForm = normalizePhone(phone);
        const formSaysFake = !inForm.ok && inForm.reason === "looks_fake";

        expect({ phone, inDatabase: await fakeInDatabase(db, phone) }).toEqual({
          phone,
          inDatabase: formSaysFake,
        });
      }
    });
  });

  it("prazan broj i smeće ne ruše funkciju", async () => {
    await withRollback(async (db) => {
      for (const value of ["", "   ", "+", "abc"]) {
        expect(await fakeInDatabase(db, value)).toBe(false);
      }
    });
  });
});
