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

type HistoryEntry = {
  id: string;
  from_status: string | null;
  to_status: string;
  actor_type: string;
  created_at: string;
};

async function history(
  db: pg.PoolClient,
  appointmentId: string,
): Promise<HistoryEntry[]> {
  const result = await db.query<{ data: HistoryEntry[] }>(
    "select appointment_history($1) as data",
    [appointmentId],
  );
  return result.rows[0]!.data;
}

async function salon(db: pg.PoolClient) {
  const tenantId = await createTenant(db);
  const userId = await createUser(db, tenantId);
  const staffId = await createStaff(db, tenantId);
  const serviceId = await createService(db, tenantId);
  const clientId = await createClient(db, tenantId);

  return { tenantId, userId, staffId, serviceId, clientId };
}

describe("istorija termina", () => {
  it("vraća promene redom, sa nastankom termina na početku", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);
      const appointment = await insertAppointment(db, {
        ...base,
        startAt: "2026-09-10T08:00:00Z",
      });

      await asUser(db, base.userId, () =>
        db.query("select change_appointment_status($1, 'completed', 'uredjaj')", [
          appointment.id,
        ]),
      );

      const entries = await asUser(db, base.userId, () =>
        history(db, appointment.id),
      );

      expect(
        entries.map((entry) => ({
          from: entry.from_status,
          to: entry.to_status,
        })),
      ).toEqual([
        { from: null, to: "confirmed" },
        { from: "confirmed", to: "completed" },
      ]);
    });
  });

  it("ne vraća uređaj ni heš mreže", async () => {
    // Ovo su tragovi za sprečavanje zloupotrebe, ne podatak koji salon vidi.
    // Politika privatnosti izričito obećava da se mrežni heš ne deli.
    await withRollback(async (db) => {
      const base = await salon(db);
      const appointment = await insertAppointment(db, {
        ...base,
        startAt: "2026-09-11T08:00:00Z",
      });

      const entries = await asUser(db, base.userId, () =>
        history(db, appointment.id),
      );

      expect(Object.keys(entries[0]!).sort()).toEqual([
        "actor_type",
        "created_at",
        "from_status",
        "id",
        "to_status",
      ]);
    });
  });

  it("vlasnica jednog salona ne vidi istoriju tuđeg termina", async () => {
    await withRollback(async (db) => {
      const mine = await salon(db);
      const theirs = await salon(db);
      const appointment = await insertAppointment(db, {
        ...theirs,
        startAt: "2026-09-12T08:00:00Z",
      });

      const seen = await asUser(db, mine.userId, () =>
        history(db, appointment.id),
      );

      // Prazno, isto kao za termin koji ne postoji: iz odgovora se ne saznaje
      // ni da tuđi termin postoji.
      expect(seen).toEqual([]);
    });
  });

  it("neulogovan posetilac ne sme ni da je pozove", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);
      const appointment = await insertAppointment(db, {
        ...base,
        startAt: "2026-09-13T08:00:00Z",
      });

      await asAnon(db, async () => {
        await expect(
          inSavepoint(db, () => history(db, appointment.id)),
        ).rejects.toThrow(/permission denied/i);
      });
    });
  });

  it("termin koji ne postoji daje praznu listu, ne grešku", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);

      const seen = await asUser(db, base.userId, () =>
        history(db, "00000000-0000-0000-0000-000000000000"),
      );

      expect(seen).toEqual([]);
    });
  });
});
