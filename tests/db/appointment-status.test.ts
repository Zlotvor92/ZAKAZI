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

type ChangeResult =
  | { ok: true; from_status: string; to_status: string }
  | { ok: false; reason: string };

async function salon(db: pg.PoolClient) {
  const tenantId = await createTenant(db);
  const userId = await createUser(db, tenantId);
  const staffId = await createStaff(db, tenantId);
  const serviceId = await createService(db, tenantId);
  const clientId = await createClient(db, tenantId);

  return { tenantId, userId, staffId, serviceId, clientId };
}

async function change(
  db: pg.PoolClient,
  appointmentId: string,
  status: string,
  deviceId: string | null = null,
): Promise<ChangeResult> {
  const result = await db.query<{ result: ChangeResult }>(
    "select change_appointment_status($1, $2, $3) as result",
    [appointmentId, status, deviceId],
  );
  return result.rows[0]!.result;
}

async function statusOf(
  db: pg.PoolClient,
  appointmentId: string,
): Promise<string> {
  const result = await db.query<{ status: string }>(
    "select status from appointments where id = $1",
    [appointmentId],
  );
  return result.rows[0]!.status;
}

describe("dozvoljeni prelazi", () => {
  it("pending ide u confirmed i u oba otkazivanja", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);

      for (const target of [
        "confirmed",
        "cancelled_by_client",
        "cancelled_by_salon",
      ]) {
        const appointment = await insertAppointment(db, {
          ...base,
          startAt: `2026-09-1${target.length % 8}T08:00:00Z`,
          status: "pending",
        });

        const result = await asUser(db, base.userId, () =>
          change(db, appointment.id, target),
        );

        expect(result.ok).toBe(true);
        expect(await statusOf(db, appointment.id)).toBe(target);
      }
    });
  });

  it("confirmed ide u completed, no_show i otkazivanja", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);

      const targets = [
        "completed",
        "no_show",
        "cancelled_by_client",
        "cancelled_by_salon",
      ];

      for (const [index, target] of targets.entries()) {
        const appointment = await insertAppointment(db, {
          ...base,
          startAt: `2026-09-2${index}T08:00:00Z`,
        });

        const result = await asUser(db, base.userId, () =>
          change(db, appointment.id, target),
        );

        expect(result).toEqual({
          ok: true,
          from_status: "confirmed",
          to_status: target,
        });
      }
    });
  });

  it("potvrda upisuje trenutak potvrde", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);
      const appointment = await insertAppointment(db, {
        ...base,
        startAt: "2026-09-10T08:00:00Z",
        status: "pending",
      });

      await asUser(db, base.userId, () => change(db, appointment.id, "confirmed"));

      const row = await db.query<{ confirmed_at: Date | null }>(
        "select confirmed_at from appointments where id = $1",
        [appointment.id],
      );

      expect(row.rows[0]!.confirmed_at).not.toBeNull();
    });
  });
});

describe("ispravka pogrešnog ishoda", () => {
  it("nedolazak se ispravlja u dolazak i nazad", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);
      const appointment = await insertAppointment(db, {
        ...base,
        startAt: "2026-09-10T08:00:00Z",
      });

      await asUser(db, base.userId, async () => {
        expect((await change(db, appointment.id, "no_show")).ok).toBe(true);
        expect((await change(db, appointment.id, "completed")).ok).toBe(true);
        expect((await change(db, appointment.id, "no_show")).ok).toBe(true);
      });

      expect(await statusOf(db, appointment.id)).toBe("no_show");
    });
  });

  it("svaka ispravka ostavlja svoj red u istoriji", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);
      const appointment = await insertAppointment(db, {
        ...base,
        startAt: "2026-09-10T08:00:00Z",
      });

      await asUser(db, base.userId, async () => {
        await change(db, appointment.id, "no_show");
        await change(db, appointment.id, "completed");
      });

      const events = await db.query<{ from_status: string; to_status: string }>(
        `select from_status, to_status from appointment_events
         where appointment_id = $1 order by created_at`,
        [appointment.id],
      );

      expect(events.rows).toEqual([
        { from_status: null, to_status: "confirmed" },
        { from_status: "confirmed", to_status: "no_show" },
        { from_status: "no_show", to_status: "completed" },
      ]);
    });
  });
});

describe("zabranjeni prelazi", () => {
  it("otkazan termin se ne vraća u život", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);
      const appointment = await insertAppointment(db, {
        ...base,
        startAt: "2026-09-10T08:00:00Z",
        status: "cancelled_by_client",
      });

      const result = await asUser(db, base.userId, () =>
        change(db, appointment.id, "confirmed"),
      );

      expect(result).toEqual({ ok: false, reason: "invalid_transition" });
      expect(await statusOf(db, appointment.id)).toBe("cancelled_by_client");
    });
  });

  it("završen termin ne ide nazad u pending", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);
      const appointment = await insertAppointment(db, {
        ...base,
        startAt: "2026-09-10T08:00:00Z",
        status: "completed",
      });

      const result = await asUser(db, base.userId, () =>
        change(db, appointment.id, "pending"),
      );

      expect(result).toEqual({ ok: false, reason: "invalid_transition" });
    });
  });

  it("pending ne preskače potvrdu do završenog", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);
      const appointment = await insertAppointment(db, {
        ...base,
        startAt: "2026-09-10T08:00:00Z",
        status: "pending",
      });

      const result = await asUser(db, base.userId, () =>
        change(db, appointment.id, "completed"),
      );

      expect(result).toEqual({ ok: false, reason: "invalid_transition" });
    });
  });

  it("zabranjen prelaz ne upisuje red u istoriju", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);
      const appointment = await insertAppointment(db, {
        ...base,
        startAt: "2026-09-10T08:00:00Z",
        status: "cancelled_by_salon",
      });

      await asUser(db, base.userId, () => change(db, appointment.id, "confirmed"));

      const events = await db.query(
        "select 1 from appointment_events where appointment_id = $1",
        [appointment.id],
      );

      expect(events.rowCount).toBe(1);
    });
  });
});

describe("isti status dva puta", () => {
  it("dupli dodir prolazi bez greške i bez novog reda", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);
      const appointment = await insertAppointment(db, {
        ...base,
        startAt: "2026-09-10T08:00:00Z",
      });

      const result = await asUser(db, base.userId, () =>
        change(db, appointment.id, "confirmed"),
      );

      expect(result.ok).toBe(true);

      const events = await db.query(
        "select 1 from appointment_events where appointment_id = $1",
        [appointment.id],
      );
      expect(events.rowCount).toBe(1);
    });
  });
});

describe("ko sme da menja status", () => {
  it("vlasnica drugog salona ne vidi termin i ne menja ga", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);
      const other = await createTenant(db);
      const intruder = await createUser(db, other);
      const appointment = await insertAppointment(db, {
        ...base,
        startAt: "2026-09-10T08:00:00Z",
      });

      const result = await asUser(db, intruder, () =>
        change(db, appointment.id, "no_show"),
      );

      expect(result).toEqual({ ok: false, reason: "not_found" });
      expect(await statusOf(db, appointment.id)).toBe("confirmed");
    });
  });

  it("neulogovan posetilac ne sme ni da pozove funkciju", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);
      const appointment = await insertAppointment(db, {
        ...base,
        startAt: "2026-09-10T08:00:00Z",
      });

      await asAnon(db, async () => {
        await expect(
          inSavepoint(db, () => change(db, appointment.id, "no_show")),
        ).rejects.toThrow(/permission denied/i);
      });
    });
  });
});

describe("uređaj i akter", () => {
  it("uređaj koji je prosleđen završi u istoriji", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);
      const appointment = await insertAppointment(db, {
        ...base,
        startAt: "2026-09-10T08:00:00Z",
      });

      await asUser(db, base.userId, () =>
        change(db, appointment.id, "completed", "telefon-vlasnice"),
      );

      const event = await db.query<{ device_id: string; actor_id: string }>(
        `select device_id, actor_id from appointment_events
         where appointment_id = $1 and to_status = 'completed'`,
        [appointment.id],
      );

      expect(event.rows[0]).toEqual({
        device_id: "telefon-vlasnice",
        actor_id: base.userId,
      });
    });
  });
});
