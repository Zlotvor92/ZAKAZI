import { afterAll, describe, expect, it } from "vitest";
import { closePool, createTenant, inSavepoint, withRollback } from "./helpers";

afterAll(closePool);

type Settings = {
  booking_horizon_days: number;
  min_lead_minutes: number;
  public_booking_enabled: boolean;
};

describe("podrazumevana podešavanja zakazivanja", () => {
  it("novi salon dobija horizont od dve nedelje i dva sata unapred", async () => {
    await withRollback(async (db) => {
      const tenantId = await createTenant(db);

      const result = await db.query<Settings>(
        `select booking_horizon_days, min_lead_minutes, public_booking_enabled
         from tenants where id = $1`,
        [tenantId],
      );

      expect(result.rows[0]).toEqual({
        booking_horizon_days: 14,
        min_lead_minutes: 120,
        public_booking_enabled: true,
      });
    });
  });
});

describe("granice podešavanja", () => {
  it("horizont mora biti bar jedan dan", async () => {
    await withRollback(async (db) => {
      const tenantId = await createTenant(db);

      await expect(
        inSavepoint(db, () =>
          db.query("update tenants set booking_horizon_days = 0 where id = $1", [
            tenantId,
          ]),
        ),
      ).rejects.toThrow(/tenants_booking_horizon_range/);
    });
  });

  it("horizont ne sme preko devedeset dana", async () => {
    await withRollback(async (db) => {
      const tenantId = await createTenant(db);

      await expect(
        inSavepoint(db, () =>
          db.query("update tenants set booking_horizon_days = 91 where id = $1", [
            tenantId,
          ]),
        ),
      ).rejects.toThrow(/tenants_booking_horizon_range/);
    });
  });

  it("najraniji termin sme da bude odmah", async () => {
    await withRollback(async (db) => {
      const tenantId = await createTenant(db);

      await db.query("update tenants set min_lead_minutes = 0 where id = $1", [
        tenantId,
      ]);

      const result = await db.query<{ min_lead_minutes: number }>(
        "select min_lead_minutes from tenants where id = $1",
        [tenantId],
      );

      expect(result.rows[0]!.min_lead_minutes).toBe(0);
    });
  });

  it("najraniji termin ne sme biti negativan ni preko nedelju dana", async () => {
    await withRollback(async (db) => {
      const tenantId = await createTenant(db);

      for (const value of [-1, 10081]) {
        await expect(
          inSavepoint(db, () =>
            db.query("update tenants set min_lead_minutes = $2 where id = $1", [
              tenantId,
              value,
            ]),
          ),
        ).rejects.toThrow(/tenants_min_lead_range/);
      }
    });
  });

  it("horizont od tri nedelje je dozvoljen", async () => {
    await withRollback(async (db) => {
      const tenantId = await createTenant(db);

      await db.query(
        "update tenants set booking_horizon_days = 21 where id = $1",
        [tenantId],
      );

      const result = await db.query<{ booking_horizon_days: number }>(
        "select booking_horizon_days from tenants where id = $1",
        [tenantId],
      );

      expect(result.rows[0]!.booking_horizon_days).toBe(21);
    });
  });
});
