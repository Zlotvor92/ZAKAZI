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

async function salon(db: pg.PoolClient) {
  const tenantId = await createTenant(db);
  const userId = await createUser(db, tenantId);
  const staffId = await createStaff(db, tenantId);
  const serviceId = await createService(db, tenantId);
  const clientId = await createClient(db, tenantId);

  return { tenantId, userId, staffId, serviceId, clientId };
}

type Salon = Awaited<ReturnType<typeof salon>>;

function book(
  db: pg.PoolClient,
  base: Salon,
  startAt: string,
  status: "confirmed" | "no_show" | "cancelled_by_salon" = "confirmed",
) {
  return insertAppointment(db, {
    tenantId: base.tenantId,
    staffId: base.staffId,
    serviceId: base.serviceId,
    clientId: base.clientId,
    startAt,
    status,
  });
}

async function runAsServer(db: pg.PoolClient, now: string): Promise<number> {
  await db.query("set local role service_role");
  try {
    const result = await db.query<{ count: number }>(
      "select complete_past_appointments($1) as count",
      [now],
    );
    return result.rows[0]!.count;
  } finally {
    await db.query("reset role");
  }
}

async function statusOf(db: pg.PoolClient, id: string): Promise<string> {
  const result = await db.query<{ status: string }>(
    "select status from appointments where id = $1",
    [id],
  );
  return result.rows[0]!.status;
}

describe("termin iz prošlog dana postaje obavljen", () => {
  it("potvrđen termin od juče se obeležava, a istorija kaže da je to sistem", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);
      const { id } = await book(db, base, "2026-10-05T10:00:00+02:00");

      const count = await runAsServer(db, "2026-10-06T02:00:00+02:00");

      expect(count).toBe(1);
      expect(await statusOf(db, id)).toBe("completed");

      const event = await db.query(
        `select from_status, to_status, actor_type, actor_id
         from appointment_events
         where appointment_id = $1 and to_status = 'completed'`,
        [id],
      );
      expect(event.rows).toEqual([
        {
          from_status: "confirmed",
          to_status: "completed",
          actor_type: "system",
          actor_id: null,
        },
      ]);
    });
  });

  it("dan se meri po satu salona, ne po UTC", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);
      // 23:30 u Beogradu je 21:30 UTC istog dana.
      const { id } = await book(db, base, "2026-10-05T23:30:00+02:00");

      // 23:59 u Beogradu: dan još traje.
      await runAsServer(db, "2026-10-05T23:59:00+02:00");
      expect(await statusOf(db, id)).toBe("confirmed");

      // 00:30 u Beogradu je i dalje 5. oktobar po UTC-u, ali u salonu je
      // već novi dan.
      await runAsServer(db, "2026-10-06T00:30:00+02:00");
      expect(await statusOf(db, id)).toBe("completed");
    });
  });

  it("današnji termin čeka kraj dana", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);
      const { id } = await book(db, base, "2026-10-05T09:00:00+02:00");

      await runAsServer(db, "2026-10-05T20:00:00+02:00");

      expect(await statusOf(db, id)).toBe("confirmed");
    });
  });

  it("izostanak i otkazan termin ostaju kakvi jesu", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);
      const noShow = await book(db, base, "2026-10-05T10:00:00+02:00", "no_show");
      const cancelled = await book(
        db,
        base,
        "2026-10-05T12:00:00+02:00",
        "cancelled_by_salon",
      );

      const count = await runAsServer(db, "2026-10-06T02:00:00+02:00");

      expect(count).toBe(0);
      expect(await statusOf(db, noShow.id)).toBe("no_show");
      expect(await statusOf(db, cancelled.id)).toBe("cancelled_by_salon");
    });
  });

  it("termini od pre uvođenja pravila se ne diraju", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);
      const old = await book(db, base, "2026-09-24T10:00:00+02:00");
      const first = await book(db, base, "2026-09-25T10:00:00+02:00");

      await runAsServer(db, "2026-10-06T02:00:00+02:00");

      expect(await statusOf(db, old.id)).toBe("confirmed");
      expect(await statusOf(db, first.id)).toBe("completed");
    });
  });

  it("vlasnica posle toga i dalje može da obeleži izostanak", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);
      const { id } = await book(db, base, "2026-10-05T10:00:00+02:00");
      await runAsServer(db, "2026-10-06T02:00:00+02:00");

      const result = await asUser(db, base.userId, async () => {
        const changed = await db.query<{ result: { ok: boolean } }>(
          "select change_appointment_status($1, 'no_show') as result",
          [id],
        );
        return changed.rows[0]!.result;
      });

      expect(result.ok).toBe(true);
      expect(await statusOf(db, id)).toBe("no_show");
    });
  });
});

describe("noćni posao je samo za server", () => {
  it("ni prijavljen nalog ni posetilac ne mogu da ga pokrenu", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);

      await asUser(db, base.userId, async () => {
        await expect(
          inSavepoint(db, () => db.query("select complete_past_appointments()")),
        ).rejects.toThrow(/permission denied/i);
      });

      await asAnon(db, async () => {
        await expect(
          inSavepoint(db, () => db.query("select complete_past_appointments()")),
        ).rejects.toThrow(/permission denied/i);
      });
    });
  });
});
