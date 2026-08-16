import type pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import {
  asUser,
  closePool,
  createClient,
  createService,
  createStaff,
  createTenant,
  createUser,
  insertAppointment,
  withRollback,
} from "./helpers";

afterAll(closePool);

type EventRow = {
  from_status: string | null;
  to_status: string;
  actor_type: string;
  actor_id: string | null;
  device_id: string | null;
};

async function events(
  db: pg.PoolClient,
  appointmentId: string,
): Promise<EventRow[]> {
  const result = await db.query<EventRow>(
    `select from_status, to_status, actor_type, actor_id, device_id
     from appointment_events
     where appointment_id = $1
     order by created_at, to_status`,
    [appointmentId],
  );
  return result.rows;
}

async function salon(db: pg.PoolClient) {
  const tenantId = await createTenant(db);
  const userId = await createUser(db, tenantId);
  const staffId = await createStaff(db, tenantId);
  const serviceId = await createService(db, tenantId);
  const clientId = await createClient(db, tenantId);

  return { tenantId, userId, staffId, serviceId, clientId };
}

describe("upis termina ostavlja trag", () => {
  it("novi termin dobija red bez prethodnog statusa", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);
      const appointment = await insertAppointment(db, {
        ...base,
        startAt: "2026-09-10T08:00:00Z",
      });

      expect(await events(db, appointment.id)).toEqual([
        {
          from_status: null,
          to_status: "confirmed",
          actor_type: "system",
          actor_id: null,
          device_id: null,
        },
      ]);
    });
  });

  it("termin upisan bez prijavljenog korisnika nosi aktera system", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);
      const appointment = await insertAppointment(db, {
        ...base,
        startAt: "2026-09-10T08:00:00Z",
        status: "pending",
      });

      const [event] = await events(db, appointment.id);

      expect(event!.actor_type).toBe("system");
      expect(event!.to_status).toBe("pending");
    });
  });

  it("termin koji upiše prijavljena vlasnica nosi njen nalog", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);

      const appointment = await asUser(db, base.userId, () =>
        insertAppointment(db, { ...base, startAt: "2026-09-10T08:00:00Z" }),
      );

      const [event] = await events(db, appointment.id);

      expect(event!.actor_type).toBe("user");
      expect(event!.actor_id).toBe(base.userId);
    });
  });
});

describe("promena statusa ostavlja trag", () => {
  it("beleži i stari i novi status", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);
      const appointment = await insertAppointment(db, {
        ...base,
        startAt: "2026-09-10T08:00:00Z",
      });

      await db.query("update appointments set status = 'completed' where id = $1", [
        appointment.id,
      ]);

      expect(await events(db, appointment.id)).toEqual([
        expect.objectContaining({ from_status: null, to_status: "confirmed" }),
        expect.objectContaining({
          from_status: "confirmed",
          to_status: "completed",
        }),
      ]);
    });
  });

  it("svaki korak lanca ima svoj red", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);
      const appointment = await insertAppointment(db, {
        ...base,
        startAt: "2026-09-10T08:00:00Z",
        status: "pending",
      });

      for (const status of ["confirmed", "completed"]) {
        await db.query("update appointments set status = $2 where id = $1", [
          appointment.id,
          status,
        ]);
      }

      const trail = await events(db, appointment.id);

      expect(trail.map((row) => [row.from_status, row.to_status])).toEqual([
        [null, "pending"],
        ["pending", "confirmed"],
        ["confirmed", "completed"],
      ]);
    });
  });

  it("otkazivanje se beleži isto kao i sve ostalo", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);
      const appointment = await insertAppointment(db, {
        ...base,
        startAt: "2026-09-10T08:00:00Z",
      });

      await db.query(
        "update appointments set status = 'cancelled_by_client' where id = $1",
        [appointment.id],
      );

      expect((await events(db, appointment.id)).at(-1)).toMatchObject({
        from_status: "confirmed",
        to_status: "cancelled_by_client",
      });
    });
  });

  it("izmena koja ne dira status ne pravi novi red", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);
      const appointment = await insertAppointment(db, {
        ...base,
        startAt: "2026-09-10T08:00:00Z",
      });

      await db.query("update appointments set price_rsd = 4000 where id = $1", [
        appointment.id,
      ]);
      await db.query("update appointments set status = 'confirmed' where id = $1", [
        appointment.id,
      ]);

      expect(await events(db, appointment.id)).toHaveLength(1);
    });
  });
});

describe("akter i uređaj se prenose kroz podešavanja transakcije", () => {
  it("javna stranica se predstavlja kao klijent", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);

      await db.query("select set_config('app.actor_type', 'client', true)");
      await db.query("select set_config('app.device_id', 'iphone-abc', true)");

      const appointment = await insertAppointment(db, {
        ...base,
        startAt: "2026-09-10T08:00:00Z",
      });

      expect((await events(db, appointment.id))[0]).toMatchObject({
        actor_type: "client",
        actor_id: null,
        device_id: "iphone-abc",
      });

      await db.query("select set_config('app.actor_type', '', true)");
      await db.query("select set_config('app.device_id', '', true)");
    });
  });

  it("uređaj se beleži i kad akter nije naveden", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);

      await db.query("select set_config('app.device_id', 'android-7', true)");

      const appointment = await asUser(db, base.userId, () =>
        insertAppointment(db, { ...base, startAt: "2026-09-10T08:00:00Z" }),
      );

      expect((await events(db, appointment.id))[0]).toMatchObject({
        actor_type: "user",
        actor_id: base.userId,
        device_id: "android-7",
      });

      await db.query("select set_config('app.device_id', '', true)");
    });
  });

  it("besmislena vrednost aktera ne obara upis termina", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);

      await db.query("select set_config('app.actor_type', 'čudo', true)");

      const appointment = await insertAppointment(db, {
        ...base,
        startAt: "2026-09-10T08:00:00Z",
      });

      // Trag mora da postoji i kad je poziv pogrešio vrednost — bolje pogrešan
      // akter nego termin bez ijednog reda u istoriji.
      expect((await events(db, appointment.id))[0]).toMatchObject({
        actor_type: "system",
      });

      await db.query("select set_config('app.actor_type', '', true)");
    });
  });
});

describe("izmena koja ne prođe ne ostavlja lažan trag", () => {
  it("vlasnica drugog salona ne promeni status, pa se ne upiše ni red", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);
      const other = await createTenant(db);
      const intruder = await createUser(db, other);

      const appointment = await insertAppointment(db, {
        ...base,
        startAt: "2026-09-10T08:00:00Z",
      });

      const changed = await asUser(db, intruder, async () => {
        const result = await db.query(
          "update appointments set status = 'no_show' where id = $1",
          [appointment.id],
        );
        return result.rowCount;
      });

      expect(changed).toBe(0);
      expect(await events(db, appointment.id)).toHaveLength(1);
    });
  });
});
