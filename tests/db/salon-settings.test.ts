import type pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import {
  asAnon,
  asUser,
  closePool,
  createStaff,
  createTenant,
  createUser,
  inSavepoint,
  withRollback,
} from "./helpers";

afterAll(closePool);

type WriteResult = { ok: true } | { ok: false; reason: string };

async function salon(db: pg.PoolClient) {
  const tenantId = await createTenant(db);
  const userId = await createUser(db, tenantId);
  const staffId = await createStaff(db, tenantId);

  return { tenantId, userId, staffId };
}

type BlockInput = {
  weekday: number;
  start_minute: number;
  end_minute: number;
  slot_minutes?: number;
};

async function setHours(
  db: pg.PoolClient,
  blocks: BlockInput[],
): Promise<WriteResult> {
  const result = await db.query<{ result: WriteResult }>(
    "select set_working_hours($1::jsonb) as result",
    [
      JSON.stringify(
        blocks.map((block) => ({ slot_minutes: 90, ...block })),
      ),
    ],
  );
  return result.rows[0]!.result;
}

async function hoursOf(db: pg.PoolClient, staffId: string) {
  const result = await db.query<{
    weekday: number;
    start_time: string;
    end_time: string;
    slot_minutes: number;
  }>(
    `select weekday, start_time, end_time, slot_minutes
     from working_hours where staff_id = $1 order by weekday, start_time`,
    [staffId],
  );
  return result.rows;
}

describe("upis radnog vremena", () => {
  it("upisuje celu nedelju odjednom", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);

      const result = await asUser(db, base.userId, () =>
        setHours(db, [
          { weekday: 1, start_minute: 540, end_minute: 780 },
          { weekday: 1, start_minute: 840, end_minute: 1200 },
          { weekday: 6, start_minute: 540, end_minute: 840 },
        ]),
      );

      expect(result).toEqual({ ok: true });
      expect(await hoursOf(db, base.staffId)).toEqual([
        { weekday: 1, start_time: "09:00:00", end_time: "13:00:00", slot_minutes: 90 },
        { weekday: 1, start_time: "14:00:00", end_time: "20:00:00", slot_minutes: 90 },
        { weekday: 6, start_time: "09:00:00", end_time: "14:00:00", slot_minutes: 90 },
      ]);
    });
  });

  it("drugi upis zamenjuje prvi, ne dodaje se na njega", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);

      await asUser(db, base.userId, async () => {
        await setHours(db, [{ weekday: 1, start_minute: 540, end_minute: 780 }]);
        await setHours(db, [{ weekday: 2, start_minute: 600, end_minute: 720 }]);
      });

      expect(await hoursOf(db, base.staffId)).toEqual([
        { weekday: 2, start_time: "10:00:00", end_time: "12:00:00", slot_minutes: 90 },
      ]);
    });
  });

  it("ponoć na kraju dana ostaje ponoć, a ne početak dana", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);

      await asUser(db, base.userId, () =>
        setHours(db, [{ weekday: 5, start_minute: 1200, end_minute: 1440 }]),
      );

      expect(await hoursOf(db, base.staffId)).toEqual([
        { weekday: 5, start_time: "20:00:00", end_time: "24:00:00", slot_minutes: 90 },
      ]);
    });
  });

  it("prazna nedelja briše sve", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);

      await asUser(db, base.userId, async () => {
        await setHours(db, [{ weekday: 1, start_minute: 540, end_minute: 780 }]);
        expect(await setHours(db, [])).toEqual({ ok: true });
      });

      expect(await hoursOf(db, base.staffId)).toEqual([]);
    });
  });

  it("smene koje se preklapaju se odbijaju, a staro ostaje", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);

      await asUser(db, base.userId, async () => {
        await setHours(db, [{ weekday: 1, start_minute: 540, end_minute: 780 }]);

        const result = await setHours(db, [
          { weekday: 2, start_minute: 540, end_minute: 780 },
          { weekday: 2, start_minute: 600, end_minute: 900 },
        ]);

        expect(result).toEqual({ ok: false, reason: "overlapping" });
      });

      // Odbijeni upis se poništio zajedno sa brisanjem koje mu je prethodilo.
      expect(await hoursOf(db, base.staffId)).toEqual([
        { weekday: 1, start_time: "09:00:00", end_time: "13:00:00", slot_minutes: 90 },
      ]);
    });
  });

  it("termin duži od bloka se odbija", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);

      const result = await asUser(db, base.userId, () =>
        setHours(db, [
          { weekday: 1, start_minute: 540, end_minute: 660, slot_minutes: 180 },
        ]),
      );

      expect(result).toEqual({ ok: false, reason: "invalid" });
    });
  });

  it("kraj pre početka se odbija", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);

      const result = await asUser(db, base.userId, () =>
        setHours(db, [{ weekday: 1, start_minute: 780, end_minute: 540 }]),
      );

      expect(result).toEqual({ ok: false, reason: "invalid" });
    });
  });

  it("vlasnica ne dira radno vreme drugog salona", async () => {
    await withRollback(async (db) => {
      const mine = await salon(db);
      const theirs = await salon(db);

      await asUser(db, theirs.userId, () =>
        setHours(db, [{ weekday: 1, start_minute: 540, end_minute: 780 }]),
      );
      await asUser(db, mine.userId, () =>
        setHours(db, [{ weekday: 3, start_minute: 600, end_minute: 900 }]),
      );

      expect(await hoursOf(db, theirs.staffId)).toHaveLength(1);
      expect((await hoursOf(db, theirs.staffId))[0]!.weekday).toBe(1);
    });
  });

  it("neulogovan posetilac ne sme ni da pozove funkciju", async () => {
    await withRollback(async (db) => {
      await salon(db);

      await asAnon(db, async () => {
        await expect(inSavepoint(db, () => setHours(db, []))).rejects.toThrow(
          /permission denied/i,
        );
      });
    });
  });
});

describe("pravila zakazivanja", () => {
  it("vlasnica menja horizont, najraniji termin i prekidač", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);

      const updated = await asUser(db, base.userId, async () => {
        const result = await db.query(
          `update tenants
              set booking_horizon_days = 21,
                  min_lead_minutes = 240,
                  public_booking_enabled = false
            where id = $1`,
          [base.tenantId],
        );
        return result.rowCount;
      });

      expect(updated).toBe(1);
    });
  });

  it("vlasnica ne sme da promeni slug, ime ni plan", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);

      await asUser(db, base.userId, async () => {
        for (const column of ["slug = 'novi'", "name = 'Novo'", "plan = 'pro'"]) {
          await expect(
            inSavepoint(db, () =>
              db.query(`update tenants set ${column} where id = $1`, [
                base.tenantId,
              ]),
            ),
          ).rejects.toThrow(/permission denied/i);
        }
      });
    });
  });

  it("vlasnica ne menja pravila tuđeg salona", async () => {
    await withRollback(async (db) => {
      const mine = await salon(db);
      const theirs = await salon(db);

      const updated = await asUser(db, mine.userId, async () => {
        const result = await db.query(
          "update tenants set booking_horizon_days = 3 where id = $1",
          [theirs.tenantId],
        );
        return result.rowCount;
      });

      expect(updated).toBe(0);

      const row = await db.query<{ booking_horizon_days: number }>(
        "select booking_horizon_days from tenants where id = $1",
        [theirs.tenantId],
      );
      expect(row.rows[0]!.booking_horizon_days).toBe(14);
    });
  });

  it("neulogovan posetilac ne menja ništa", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);

      const updated = await asAnon(db, async () => {
        const result = await db.query(
          "update tenants set booking_horizon_days = 3 where id = $1",
          [base.tenantId],
        );
        return result.rowCount;
      });

      expect(updated).toBe(0);
    });
  });
});
