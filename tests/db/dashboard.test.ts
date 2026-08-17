import type pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { appointmentListSchema } from "@/lib/db/appointments";
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

async function salon(db: pg.PoolClient) {
  const tenantId = await createTenant(db);
  const userId = await createUser(db, tenantId);
  const staffId = await createStaff(db, tenantId);
  const serviceId = await createService(db, tenantId);
  const clientId = await createClient(db, tenantId);

  return { tenantId, userId, staffId, serviceId, clientId };
}

async function listed(
  db: pg.PoolClient,
  from: string,
  to: string,
): Promise<Record<string, unknown>[]> {
  const result = await db.query(
    "select * from dashboard_appointments($1, $2)",
    [from, to],
  );
  return result.rows;
}

const SEPTEMBER = ["2026-09-01T00:00:00Z", "2026-10-01T00:00:00Z"] as const;

describe("dashboard_appointments", () => {
  it("vraća termin sa imenom klijentkinje i nazivom usluge", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);
      await insertAppointment(db, {
        ...base,
        startAt: "2026-09-10T08:00:00Z",
      });

      const rows = await asUser(db, base.userId, () =>
        listed(db, ...SEPTEMBER),
      );

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        client_name: "Jelena",
        service_name: "Gel nokti",
        status: "confirmed",
        source: "salon",
      });
    });
  });

  it("oblik reda se poklapa sa onim što aplikacija očekuje", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);
      await insertAppointment(db, {
        ...base,
        startAt: "2026-09-10T08:00:00Z",
      });

      const rows = await asUser(db, base.userId, () =>
        listed(db, ...SEPTEMBER),
      );

      // Redovi stižu kroz PostgREST kao JSON, pa se datumi pretvaraju u niske.
      const asJson = JSON.parse(JSON.stringify(rows));

      expect(() => appointmentListSchema.parse(asJson)).not.toThrow();
    });
  });

  it("poređani su po vremenu početka", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);
      for (const at of [
        "2026-09-10T12:00:00Z",
        "2026-09-10T08:00:00Z",
        "2026-09-10T10:00:00Z",
      ]) {
        await insertAppointment(db, { ...base, startAt: at });
      }

      const rows = await asUser(db, base.userId, () =>
        listed(db, ...SEPTEMBER),
      );

      expect(rows.map((row) => row["start_at"])).toEqual([
        new Date("2026-09-10T08:00:00Z"),
        new Date("2026-09-10T10:00:00Z"),
        new Date("2026-09-10T12:00:00Z"),
      ]);
    });
  });

  it("raspon seče ono što ne pripada", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);
      await insertAppointment(db, { ...base, startAt: "2026-08-31T22:00:00Z" });
      await insertAppointment(db, { ...base, startAt: "2026-09-10T08:00:00Z" });
      await insertAppointment(db, { ...base, startAt: "2026-10-01T08:00:00Z" });

      const rows = await asUser(db, base.userId, () =>
        listed(db, ...SEPTEMBER),
      );

      expect(rows).toHaveLength(1);
    });
  });

  it("otkazan termin i dalje izlazi, jer o njemu odlučuje aplikacija", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);
      await insertAppointment(db, {
        ...base,
        startAt: "2026-09-10T08:00:00Z",
        status: "cancelled_by_client",
      });

      const rows = await asUser(db, base.userId, () =>
        listed(db, ...SEPTEMBER),
      );

      expect(rows).toHaveLength(1);
    });
  });

  it("vlasnica ne vidi tuđe termine ni kroz ovu funkciju", async () => {
    await withRollback(async (db) => {
      const mine = await salon(db);
      const theirs = await salon(db);

      await insertAppointment(db, {
        ...theirs,
        startAt: "2026-09-10T08:00:00Z",
      });

      const rows = await asUser(db, mine.userId, () =>
        listed(db, ...SEPTEMBER),
      );

      expect(rows).toEqual([]);
    });
  });

  it("neulogovan posetilac ne sme ni da je pozove", async () => {
    await withRollback(async (db) => {
      await salon(db);

      await asAnon(db, async () => {
        await expect(
          inSavepoint(db, () => listed(db, ...SEPTEMBER)),
        ).rejects.toThrow(/permission denied/i);
      });
    });
  });
});
