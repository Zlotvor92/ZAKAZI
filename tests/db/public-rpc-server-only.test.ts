import type pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import {
  asAnon,
  asServer,
  asUser,
  closePool,
  createClient,
  createService,
  createStaff,
  createTenant,
  createUser,
  inSavepoint,
  withRollback,
} from "./helpers";

afterAll(closePool);

async function salon(db: pg.PoolClient) {
  const tenantId = await createTenant(db);
  const userId = await createUser(db, tenantId);
  const staffId = await createStaff(db, tenantId);
  const serviceId = await createService(db, tenantId, 15);
  await db.query(
    "insert into staff_services (tenant_id, staff_id, service_id) values ($1,$2,$3)",
    [tenantId, staffId, serviceId],
  );
  for (const weekday of [1, 2, 3, 4, 5, 6, 7]) {
    await db.query(
      `insert into working_hours (tenant_id, staff_id, weekday, start_time, end_time, slot_minutes)
       values ($1,$2,$3,'09:00','18:00',15)`,
      [tenantId, staffId, weekday],
    );
  }
  await db.query(
    "update tenants set min_lead_minutes = 0, booking_horizon_days = 30 where id = $1",
    [tenantId],
  );
  const { rows } = await db.query<{ slug: string }>(
    "select slug from tenants where id = $1",
    [tenantId],
  );
  const clientId = await createClient(db, tenantId, "+381641110000");
  return { tenantId, userId, staffId, serviceId, clientId, slug: rows[0]!.slug };
}

async function localInstant(db: pg.PoolClient, day: number, time: string) {
  const { rows } = await db.query<{ at: string }>(
    `select to_char((((now() at time zone 'Europe/Belgrade')::date + $1::int) + $2::time)
       at time zone 'Europe/Belgrade', 'YYYY-MM-DD"T"HH24:MI:SSOF') as at`,
    [day, time],
  );
  return rows[0]!.at;
}

const CALLS: Record<string, string> = {
  public_book: "select public_book($1, gen_random_uuid(), now() + interval '2 days', 'A', '+381645123480', null, 'hash')",
  public_cancel_appointment:
    "select public_cancel_appointment($1, '+381645123480', gen_random_uuid(), array[]::text[], null, 'hash')",
  public_appointments_for_proof:
    "select public_appointments_for_proof($1, '+381645123480', array[]::text[], null)",
};

describe("zakazivanje, otkazivanje i pretragu zove samo server", () => {
  for (const [name, sql] of Object.entries(CALLS)) {
    it(`${name}: anon dobija permission denied`, async () => {
      await withRollback(async (db) => {
        const s = await salon(db);
        await asAnon(db, async () => {
          await expect(
            inSavepoint(db, () => db.query(sql, [s.slug])),
          ).rejects.toThrow(/permission denied/);
        });
      });
    });

    it(`${name}: ni prijavljena vlasnica ne može direktno`, async () => {
      await withRollback(async (db) => {
        const s = await salon(db);
        await asUser(db, s.userId, async () => {
          await expect(
            inSavepoint(db, () => db.query(sql, [s.slug])),
          ).rejects.toThrow(/permission denied/);
        });
      });
    });

    it(`${name}: server (service_role) može`, async () => {
      await withRollback(async (db) => {
        const s = await salon(db);
        await asServer(db, async () => {
          await expect(db.query(sql, [s.slug])).resolves.toBeDefined();
        });
      });
    });
  }

  it("javne funkcije koje ne utiču na limite ostaju dostupne anon roli", async () => {
    await withRollback(async (db) => {
      const s = await salon(db);
      await asAnon(db, async () => {
        const data = await db.query("select public_booking_data($1) as d", [s.slug]);
        const summary = await db.query("select public_salon_summary($1) as d", [s.slug]);
        expect(data.rows[0]!.d).not.toBeNull();
        expect(summary.rows[0]!.d).not.toBeNull();
      });
    });
  });
});

describe("limit po mreži koristi adresu koju vidi server", () => {
  it("bez hash-a iz aplikacije važi x-real-ip: deveto zakazivanje sa iste adrese pada", async () => {
    await withRollback(async (db) => {
      const s = await salon(db);
      await db.query("select set_config('request.headers', $1, true)", [
        JSON.stringify({ "x-real-ip": "203.0.113.9" }),
      ]);

      const reasons: (string | undefined)[] = [];
      for (let index = 0; index < 9; index += 1) {
        const startAt = await localInstant(db, 3, `${9 + index}:00`);
        const result = await asServer(db, async () =>
          (
            await db.query<{ r: { ok: boolean; reason?: string } }>(
              "select public_book($1,$2,$3,'Test',$4,null,null) as r",
              [s.slug, s.serviceId, startAt, `+38164${String(4173829 + index * 7919).slice(-7)}`],
            )
          ).rows[0]!.r,
        );
        reasons.push(result.ok ? "ok" : result.reason);
      }

      expect(reasons.slice(0, 8).every((r) => r === "ok")).toBe(true);
      expect(reasons[8]).toBe("too_many_from_network");
    });
  });
});
