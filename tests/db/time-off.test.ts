import type pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import {
  asAnon,
  asUser,
  closePool,
  createService,
  createStaff,
  createTenant,
  createUser,
  inSavepoint,
  withRollback,
} from "./helpers";

afterAll(closePool);

type WriteResult = { ok: true; id: string } | { ok: false; reason: string };

async function salon(db: pg.PoolClient) {
  const tenantId = await createTenant(db);
  const userId = await createUser(db, tenantId);
  const staffId = await createStaff(db, tenantId);
  const serviceId = await createService(db, tenantId);

  await db.query(
    `insert into staff_services (tenant_id, staff_id, service_id) values ($1, $2, $3)`,
    [tenantId, staffId, serviceId],
  );
  await db.query(
    `insert into working_hours
           (tenant_id, staff_id, weekday, start_time, end_time, slot_minutes)
     values ($1, $2, 1, '09:00', '13:00', 90)`,
    [tenantId, staffId],
  );
  await db.query(
    "update tenants set min_lead_minutes = 0, booking_horizon_days = 90 where id = $1",
    [tenantId],
  );

  const slug = await db.query<{ slug: string }>(
    "select slug from tenants where id = $1",
    [tenantId],
  );

  return { tenantId, userId, staffId, serviceId, slug: slug.rows[0]!.slug };
}

async function add(
  db: pg.PoolClient,
  startAt: string,
  endAt: string,
  reason: string | null = null,
): Promise<WriteResult> {
  const result = await db.query<{ result: WriteResult }>(
    "select add_time_off($1, $2, $3) as result",
    [startAt, endAt, reason],
  );
  return result.rows[0]!.result;
}

describe("unos odsustva", () => {
  it("upisuje odsustvo za izvođača salona", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);

      const result = await asUser(db, base.userId, () =>
        add(db, "2026-09-14T00:00:00Z", "2026-09-15T00:00:00Z", "lekar"),
      );

      expect(result.ok).toBe(true);

      const rows = await db.query<{ staff_id: string; reason: string }>(
        "select staff_id, reason from time_off where tenant_id = $1",
        [base.tenantId],
      );
      expect(rows.rows[0]).toEqual({ staff_id: base.staffId, reason: "lekar" });
    });
  });

  it("prazan razlog se čuva kao odsustvo bez razloga", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);

      await asUser(db, base.userId, () =>
        add(db, "2026-09-14T00:00:00Z", "2026-09-15T00:00:00Z", "   "),
      );

      const rows = await db.query<{ reason: string | null }>(
        "select reason from time_off where tenant_id = $1",
        [base.tenantId],
      );
      expect(rows.rows[0]!.reason).toBeNull();
    });
  });

  it("kraj pre početka se odbija", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);

      const result = await asUser(db, base.userId, () =>
        add(db, "2026-09-15T00:00:00Z", "2026-09-14T00:00:00Z"),
      );

      expect(result).toEqual({ ok: false, reason: "end_before_start" });
    });
  });

  it("dva odsustva smeju da se preklope", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);

      await asUser(db, base.userId, async () => {
        expect((await add(db, "2026-09-14T00:00:00Z", "2026-09-20T00:00:00Z")).ok).toBe(true);
        expect((await add(db, "2026-09-16T00:00:00Z", "2026-09-17T00:00:00Z")).ok).toBe(true);
      });
    });
  });

  it("vlasnica briše svoje odsustvo, tuđe ne", async () => {
    await withRollback(async (db) => {
      const mine = await salon(db);
      const theirs = await salon(db);

      await asUser(db, theirs.userId, () =>
        add(db, "2026-09-14T00:00:00Z", "2026-09-15T00:00:00Z"),
      );

      const deleted = await asUser(db, mine.userId, async () => {
        const result = await db.query("delete from time_off");
        return result.rowCount;
      });

      expect(deleted).toBe(0);
      const left = await db.query("select 1 from time_off");
      expect(left.rowCount).toBe(1);
    });
  });

  it("neulogovan posetilac ne sme ni da pozove funkciju", async () => {
    await withRollback(async (db) => {
      await salon(db);

      await asAnon(db, async () => {
        await expect(
          inSavepoint(db, () =>
            add(db, "2026-09-14T00:00:00Z", "2026-09-15T00:00:00Z"),
          ),
        ).rejects.toThrow(/permission denied/i);
      });
    });
  });
});

describe("odsustvo zatvara javno zakazivanje", () => {
  it("javna stranica ga vidi kao zauzeto vreme", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);
      const monday = await db.query<{ at: string }>(
        `select to_char(
                  (date_trunc('week', (now() at time zone 'Europe/Belgrade')::date + 14)::date
                   + $1::time) at time zone 'Europe/Belgrade',
                  'YYYY-MM-DD"T"HH24:MI:SSOF') as at`,
        ["09:00"],
      );
      const start = monday.rows[0]!.at;
      const end = (
        await db.query<{ at: string }>(
          `select to_char(($1::timestamptz + interval '4 hours'), 'YYYY-MM-DD"T"HH24:MI:SSOF') as at`,
          [start],
        )
      ).rows[0]!.at;

      await asUser(db, base.userId, () => add(db, start, end, "lekar"));

      const data = await asAnon(db, async () => {
        const result = await db.query<{
          data: { staff: { busy: unknown[] }[] };
        }>("select public_booking_data($1) as data", [base.slug]);
        return result.rows[0]!.data;
      });

      expect(data.staff[0]!.busy).toHaveLength(1);

      const booked = await asAnon(db, async () => {
        const result = await db.query<{ result: { ok: boolean; reason?: string } }>(
          "select public_book($1, $2, $3, $4, $5, null) as result",
          [base.slug, base.serviceId, start, "Jelena", "+381645557001"],
        );
        return result.rows[0]!.result;
      });

      expect(booked).toEqual({ ok: false, reason: "time_off" });
    });
  });
});
