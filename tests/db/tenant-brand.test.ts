import type pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import {
  asAnon,
  asUser,
  closePool,
  createTenant,
  createUser,
  inSavepoint,
  withRollback,
} from "./helpers";

afterAll(closePool);

type BrandResult = { ok: true } | { ok: false; reason: string };

async function setBrand(
  db: pg.PoolClient,
  input: {
    tenantId: string;
    background: string | null;
    primary: string | null;
    accent?: string | null;
  },
): Promise<BrandResult> {
  const result = await db.query<{ result: BrandResult }>(
    "select set_tenant_brand($1, $2, $3, $4) as result",
    [input.tenantId, input.background, input.primary, input.accent ?? null],
  );
  return result.rows[0]!.result;
}

async function brandOf(db: pg.PoolClient, tenantId: string) {
  const result = await db.query<{
    brand_background: string | null;
    brand_primary: string | null;
    brand_accent: string | null;
  }>(
    "select brand_background, brand_primary, brand_accent from tenants where id = $1",
    [tenantId],
  );
  return result.rows[0]!;
}

describe("boje salona", () => {
  it("vlasnica postavlja svoje boje", async () => {
    await withRollback(async (db) => {
      const tenantId = await createTenant(db);
      const userId = await createUser(db, tenantId);

      const result = await asUser(db, userId, () =>
        setBrand(db, {
          tenantId,
          background: "#102030",
          primary: "#ffcc00",
          accent: "#00aa88",
        }),
      );

      expect(result).toEqual({ ok: true });
      expect(await brandOf(db, tenantId)).toEqual({
        brand_background: "#102030",
        brand_primary: "#ffcc00",
        brand_accent: "#00aa88",
      });
    });
  });

  it("velika slova i razmaci se svode na isti zapis", async () => {
    // Ograničenje `tenants_brand_format` prima samo mala slova, pa bi bez
    // svođenja unos iz pregledača umeo da obori upis.
    await withRollback(async (db) => {
      const tenantId = await createTenant(db);
      const userId = await createUser(db, tenantId);

      await asUser(db, userId, () =>
        setBrand(db, { tenantId, background: "  #AABBCC ", primary: "#DDEEFF" }),
      );

      expect(await brandOf(db, tenantId)).toMatchObject({
        brand_background: "#aabbcc",
        brand_primary: "#ddeeff",
      });
    });
  });

  it("prazne vrednosti brišu boje", async () => {
    await withRollback(async (db) => {
      const tenantId = await createTenant(db);
      const userId = await createUser(db, tenantId);

      await asUser(db, userId, () =>
        setBrand(db, { tenantId, background: "#102030", primary: "#ffcc00" }),
      );
      const cleared = await asUser(db, userId, () =>
        setBrand(db, { tenantId, background: null, primary: null }),
      );

      expect(cleared).toEqual({ ok: true });
      expect(await brandOf(db, tenantId)).toEqual({
        brand_background: null,
        brand_primary: null,
        brand_accent: null,
      });
    });
  });

  it("pozadina bez osnovne boje se odbija", async () => {
    // `brandVariables` vraća null ako ijedna nedostaje, pa bi salon mislio da
    // je sačuvao boje dok bi javna strana ostala podrazumevana.
    await withRollback(async (db) => {
      const tenantId = await createTenant(db);
      const userId = await createUser(db, tenantId);

      const result = await asUser(db, userId, () =>
        setBrand(db, { tenantId, background: "#102030", primary: null }),
      );

      expect(result).toEqual({ ok: false, reason: "incomplete" });
      expect(await brandOf(db, tenantId)).toMatchObject({
        brand_background: null,
      });
    });
  });

  it("neispravna boja se odbija", async () => {
    await withRollback(async (db) => {
      const tenantId = await createTenant(db);
      const userId = await createUser(db, tenantId);

      for (const bad of ["crvena", "#fff", "#12345g", "rgb(1,2,3)"]) {
        const result = await asUser(db, userId, () =>
          setBrand(db, { tenantId, background: bad, primary: "#ffcc00" }),
        );
        expect({ bad, result }).toEqual({
          bad,
          result: { ok: false, reason: "invalid_color" },
        });
      }
    });
  });

  it("vlasnica jednog salona ne menja boje tuđeg", async () => {
    await withRollback(async (db) => {
      const mine = await createTenant(db);
      const userId = await createUser(db, mine);
      const theirs = await createTenant(db);

      const result = await asUser(db, userId, () =>
        setBrand(db, {
          tenantId: theirs,
          background: "#102030",
          primary: "#ffcc00",
        }),
      );

      expect(result).toEqual({ ok: false, reason: "not_allowed" });
      expect(await brandOf(db, theirs)).toMatchObject({
        brand_background: null,
      });
    });
  });

  it("neulogovan posetilac ne sme ni da je pozove", async () => {
    await withRollback(async (db) => {
      const tenantId = await createTenant(db);

      await asAnon(db, async () => {
        await expect(
          inSavepoint(db, () =>
            setBrand(db, {
              tenantId,
              background: "#102030",
              primary: "#ffcc00",
            }),
          ),
        ).rejects.toThrow(/permission denied/i);
      });
    });
  });
});
