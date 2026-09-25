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

type Prior = {
  total: number;
  latest: { start_at: string; service_name: string }[];
};

async function salon(db: pg.PoolClient) {
  const tenantId = await createTenant(db);
  const userId = await createUser(db, tenantId);
  const staffId = await createStaff(db, tenantId);
  const serviceId = await createService(db, tenantId);
  const clientId = await createClient(db, tenantId);
  return { tenantId, userId, staffId, serviceId, clientId };
}

type Salon = Awaited<ReturnType<typeof salon>>;

async function book(
  db: pg.PoolClient,
  base: Salon,
  startAt: string,
  status: "confirmed" | "completed" | "no_show",
  clientId = base.clientId,
): Promise<string> {
  const { id } = await insertAppointment(db, {
    tenantId: base.tenantId,
    staffId: base.staffId,
    serviceId: base.serviceId,
    clientId,
    startAt,
    status,
  });
  return id;
}

async function prior(db: pg.PoolClient, appointmentId: string): Promise<Prior> {
  await db.query("set local role service_role");
  try {
    const result = await db.query<{ prior: Prior }>(
      "select prior_no_shows($1) as prior",
      [appointmentId],
    );
    return result.rows[0]!.prior;
  } finally {
    await db.query("reset role");
  }
}

describe("raniji izostanci za obaveštenje", () => {
  it("vraća ukupan broj i najviše tri poslednja, najnoviji prvi", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);
      for (const month of ["01", "02", "03", "04"]) {
        await book(db, base, `2026-${month}-05T10:00:00+01:00`, "no_show");
      }
      await book(db, base, "2026-05-05T10:00:00+02:00", "completed");
      const fresh = await book(db, base, "2099-01-05T10:00:00+01:00", "confirmed");

      const result = await prior(db, fresh);

      expect(result.total).toBe(4);
      expect(result.latest.map((p) => new Date(p.start_at).getUTCMonth() + 1)).toEqual([
        4, 3, 2,
      ]);
      expect(result.latest[0]!.service_name).toBe("Gel nokti");
    });
  });

  it("klijentkinja bez izostanaka daje nulu", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);
      await book(db, base, "2026-01-05T10:00:00+01:00", "completed");
      const fresh = await book(db, base, "2099-01-05T10:00:00+01:00", "confirmed");

      expect(await prior(db, fresh)).toEqual({ total: 0, latest: [] });
    });
  });

  it("izostanak druge klijentkinje se ne broji", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);
      const other = await createClient(db, base.tenantId);
      await book(db, base, "2026-01-05T10:00:00+01:00", "no_show", other);
      const fresh = await book(db, base, "2099-01-05T10:00:00+01:00", "confirmed");

      expect((await prior(db, fresh)).total).toBe(0);
    });
  });

  it("dostupna je samo serveru", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);
      const fresh = await book(db, base, "2099-01-05T10:00:00+01:00", "confirmed");

      await asUser(db, base.userId, async () => {
        await expect(
          inSavepoint(db, () => db.query("select prior_no_shows($1)", [fresh])),
        ).rejects.toThrow(/permission denied/i);
      });
      await asAnon(db, async () => {
        await expect(
          inSavepoint(db, () => db.query("select prior_no_shows($1)", [fresh])),
        ).rejects.toThrow(/permission denied/i);
      });
    });
  });
});

describe("kalendar pokazuje raniji izostanak na terminu", () => {
  it("dashboard_week broji izostanke klijentkinje, bez samog termina", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);
      await book(db, base, "2026-01-05T10:00:00+01:00", "no_show");
      await book(db, base, "2026-02-05T10:00:00+01:00", "no_show");
      await book(db, base, "2026-10-05T10:00:00+02:00", "confirmed");
      const other = await createClient(db, base.tenantId);
      await book(db, base, "2026-10-06T10:00:00+02:00", "no_show", other);

      const week = await asUser(db, base.userId, async () => {
        const result = await db.query<{
          week: { appointments: { client_no_shows: number; status: string }[] };
        }>("select dashboard_week('2026-10-05', $1) as week", [base.tenantId]);
        return result.rows[0]!.week;
      });

      expect(
        week.appointments.map((a) => [a.status, a.client_no_shows]),
      ).toEqual([
        ["confirmed", 2],
        ["no_show", 0],
      ]);
    });
  });
});
