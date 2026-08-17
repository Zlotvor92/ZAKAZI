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

type Week = {
  tenant: { timezone: string; name: string };
  today: string;
  week_start: string;
  working_hours: { weekday: number }[];
  appointments: Record<string, unknown>[];
};

async function week(
  db: pg.PoolClient,
  date: string | null,
): Promise<Week | null> {
  const result = await db.query<{ w: Week | null }>(
    "select dashboard_week($1) as w",
    [date],
  );
  return result.rows[0]!.w;
}

async function listed(
  db: pg.PoolClient,
  date: string,
): Promise<Record<string, unknown>[]> {
  return (await week(db, date))?.appointments ?? [];
}

/** Ponedeljak nedelje u kojoj su svi termini iz ovih testova. */
const SEPTEMBER = "2026-09-07";

describe("dashboard_week", () => {
  it("vraća termin sa imenom klijentkinje i nazivom usluge", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);
      await insertAppointment(db, {
        ...base,
        startAt: "2026-09-10T08:00:00Z",
      });

      const rows = await asUser(db, base.userId, () =>
        listed(db, SEPTEMBER),
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
        listed(db, SEPTEMBER),
      );

      expect(() => appointmentListSchema.parse(rows)).not.toThrow();
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
        listed(db, SEPTEMBER),
      );

      expect(
        rows.map((row) => new Date(String(row["start_at"])).toISOString()),
      ).toEqual([
        "2026-09-10T08:00:00.000Z",
        "2026-09-10T10:00:00.000Z",
        "2026-09-10T12:00:00.000Z",
      ]);
    });
  });

  it("vraća tačno nedelju kojoj traženi dan pripada", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);
      // Nedelja 07–13.09.2026. Prvi i poslednji su van nje za po jedan dan.
      await insertAppointment(db, { ...base, startAt: "2026-09-06T20:00:00Z" });
      await insertAppointment(db, { ...base, startAt: "2026-09-07T08:00:00Z" });
      await insertAppointment(db, { ...base, startAt: "2026-09-13T20:00:00Z" });
      await insertAppointment(db, { ...base, startAt: "2026-09-14T08:00:00Z" });

      const rows = await asUser(db, base.userId, () => listed(db, SEPTEMBER));

      expect(rows).toHaveLength(2);
    });
  });

  it("bilo koji dan nedelje daje isti ponedeljak", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);

      const starts = await asUser(db, base.userId, async () => {
        const monday = await week(db, "2026-09-07");
        const sunday = await week(db, "2026-09-13");
        return [monday!.week_start, sunday!.week_start];
      });

      expect(starts[0]).toBe(starts[1]);
      expect(new Date(String(starts[0])).toISOString().slice(0, 10)).toBe(
        "2026-09-07",
      );
    });
  });

  it("bez datuma vraća današnju nedelju i današnji dan", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);

      const today = await asUser(db, base.userId, async () => {
        const now = await week(db, null);
        return now!.today;
      });

      expect(today).toBeTruthy();
    });
  });

  it("salon i radno vreme stižu istim pozivom", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);
      const staffId = await db.query<{ id: string }>(
        "select id from staff where tenant_id = $1",
        [base.tenantId],
      );
      await db.query(
        `insert into working_hours (tenant_id, staff_id, weekday, start_time, end_time)
         values ($1, $2, 1, '09:00', '13:00')`,
        [base.tenantId, staffId.rows[0]!.id],
      );

      const data = await asUser(db, base.userId, () => week(db, SEPTEMBER));

      expect(data!.tenant.timezone).toBe("Europe/Belgrade");
      expect(data!.working_hours).toHaveLength(1);
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
        listed(db, SEPTEMBER),
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
        listed(db, SEPTEMBER),
      );

      expect(rows).toEqual([]);
    });
  });

  it("neulogovan posetilac ne sme ni da je pozove", async () => {
    await withRollback(async (db) => {
      await salon(db);

      await asAnon(db, async () => {
        await expect(
          inSavepoint(db, () => week(db, SEPTEMBER)),
        ).rejects.toThrow(/permission denied/i);
      });
    });
  });

  it("nalog bez salona ne dobija ništa", async () => {
    await withRollback(async (db) => {
      const orphanTenant = await createTenant(db);
      const orphan = await createUser(db, orphanTenant);
      await db.query("delete from memberships where user_id = $1", [orphan]);

      const data = await asUser(db, orphan, () => week(db, SEPTEMBER));

      expect(data).toBeNull();
    });
  });
});
