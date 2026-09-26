import type pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import {
  asAnon,
  asUser,
  closePool,
  createClient,
  createService,
  createStaff,
  createTenant,
  createUser,
  inSavepoint,
  insertAppointment,
  withRollback,
} from "./helpers";

afterAll(closePool);

/** Salon koji radi ponedeljkom 09–12 i 17–20. */
async function salon(db: pg.PoolClient) {
  const tenantId = await createTenant(db);
  const userId = await createUser(db, tenantId);
  const staffId = await createStaff(db, tenantId);
  const serviceId = await createService(db, tenantId, 60);
  const clientId = await createClient(db, tenantId, "+381645550777");
  await db.query(
    `insert into working_hours
       (tenant_id, staff_id, weekday, start_time, end_time, slot_minutes)
     values ($1, $2, 1, '09:00', '12:00', 60), ($1, $2, 1, '17:00', '20:00', 60)`,
    [tenantId, staffId],
  );
  return { tenantId, userId, staffId, serviceId, clientId };
}

type Salon = Awaited<ReturnType<typeof salon>>;

/** Ponedeljak za dve nedelje, u dato vreme po Beogradu (ili drugi dan u nedelji). */
async function at(db: pg.PoolClient, time: string, dayOffset = 0): Promise<string> {
  const result = await db.query<{ at: string }>(
    `select ((date_trunc('week', (now() at time zone 'Europe/Belgrade')::date + 14)::date
              + $2::int + $1::time) at time zone 'Europe/Belgrade')::text as at`,
    [time, dayOffset],
  );
  return result.rows[0]!.at;
}

async function book(
  db: pg.PoolClient,
  base: Salon,
  startAt: string,
  status: "confirmed" | "cancelled_by_client" = "confirmed",
) {
  return (
    await insertAppointment(db, {
      tenantId: base.tenantId,
      staffId: base.staffId,
      serviceId: base.serviceId,
      clientId: base.clientId,
      startAt,
      status,
    })
  ).id;
}

async function outside(db: pg.PoolClient, userId: string, tenantId: string) {
  return asUser(db, userId, async () => {
    const result = await db.query<{ id: string }>(
      "select id from appointments_outside_hours($1)",
      [tenantId],
    );
    return result.rows.map((row) => row.id);
  });
}

describe("termini van radnog vremena", () => {
  it("nalazi termin u pauzi, posle smene i u neradni dan, a ne onaj u smeni", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);
      const inside = await book(db, base, await at(db, "10:00"));
      const lastSlot = await book(db, base, await at(db, "19:00"));
      const inBreak = await book(db, base, await at(db, "13:00"));
      const afterShift = await book(db, base, await at(db, "20:00"));
      const dayOff = await book(db, base, await at(db, "10:00", 2));

      const found = await outside(db, base.userId, base.tenantId);

      expect(found).toEqual([inBreak, afterShift, dayOff]);
      expect(found).not.toContain(inside);
      expect(found).not.toContain(lastSlot);
    });
  });

  it("otkazan termin se ne računa", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);
      await book(db, base, await at(db, "13:00"), "cancelled_by_client");

      expect(await outside(db, base.userId, base.tenantId)).toEqual([]);
    });
  });

  it("drugi salon ne vidi ništa, a neprijavljen ne može ni da pita", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);
      const other = await salon(db);
      await book(db, base, await at(db, "13:00"));

      expect(await outside(db, other.userId, base.tenantId)).toEqual([]);
      await asAnon(db, async () => {
        await expect(
          inSavepoint(db, () =>
            db.query("select * from appointments_outside_hours($1)", [base.tenantId]),
          ),
        ).rejects.toThrow(/permission denied/i);
      });
    });
  });
});
