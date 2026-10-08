import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import {
  asUser,
  closePool,
  createService,
  createStaff,
  createTenant,
  createUser,
  futureStartAt,
  withRollback,
} from "./helpers";
import { cleanupSalon, createCommittedSalon, racePool } from "./race";

afterAll(async () => {
  await closePool();
  await racePool.end();
});

type WriteResult =
  | { ok: true; appointment_id: string; replayed?: boolean }
  | { ok: false; reason: string };

async function salon(db: pg.PoolClient) {
  const tenantId = await createTenant(db);
  const userId = await createUser(db, tenantId);
  await createStaff(db, tenantId);
  const serviceId = await createService(db, tenantId);
  return { tenantId, userId, serviceId };
}

async function create(
  db: pg.PoolClient,
  input: {
    serviceId: string;
    startAt: string;
    durationMin?: number;
    phone?: string;
    requestId?: string | null;
  },
): Promise<WriteResult> {
  const result = await db.query<{ result: WriteResult }>(
    "select create_appointment($1, $2, $3, 'Jelena', $4, null, $5) as result",
    [
      input.serviceId,
      input.startAt,
      input.durationMin ?? 90,
      input.phone ?? "+381641234567",
      input.requestId ?? null,
    ],
  );
  return result.rows[0]!.result;
}

describe("ručni unos termina sa request_id", () => {
  it("ponovljen zahtev vraća isti termin, bez drugog reda i drugog događaja", async () => {
    await withRollback(async (db) => {
      const s = await salon(db);
      const requestId = randomUUID();
      const startAt = futureStartAt();

      const first = await asUser(db, s.userId, () =>
        create(db, { serviceId: s.serviceId, startAt, requestId }),
      );
      const second = await asUser(db, s.userId, () =>
        create(db, { serviceId: s.serviceId, startAt, requestId }),
      );

      expect(first.ok && !("replayed" in first)).toBe(true);
      expect(second).toMatchObject({ ok: true, replayed: true });
      expect(second.ok && second.appointment_id).toBe(
        first.ok && first.appointment_id,
      );

      const rows = await db.query<{ n: string }>(
        "select count(*) as n from appointments where tenant_id = $1",
        [s.tenantId],
      );
      expect(rows.rows[0]!.n).toBe("1");

      const events = await db.query<{ n: string }>(
        "select count(*) as n from appointment_events where tenant_id = $1",
        [s.tenantId],
      );
      expect(events.rows[0]!.n).toBe("1");
    });
  });

  it("bez request_id isti slot i dalje daje slot_taken", async () => {
    await withRollback(async (db) => {
      const s = await salon(db);
      const startAt = futureStartAt();

      await asUser(db, s.userId, () =>
        create(db, { serviceId: s.serviceId, startAt }),
      );
      const second = await asUser(db, s.userId, () =>
        create(db, { serviceId: s.serviceId, startAt }),
      );

      expect(second).toEqual({ ok: false, reason: "slot_taken" });
    });
  });

  it("isti request_id za drugi broj, vreme ili trajanje nije ponavljanje", async () => {
    await withRollback(async (db) => {
      const s = await salon(db);
      const requestId = randomUUID();
      const startAt = futureStartAt();

      await asUser(db, s.userId, () =>
        create(db, { serviceId: s.serviceId, startAt, requestId }),
      );

      const otherPhone = await asUser(db, s.userId, () =>
        create(db, {
          serviceId: s.serviceId,
          startAt,
          requestId,
          phone: "+381641112223",
        }),
      );
      expect(otherPhone).toEqual({ ok: false, reason: "request_conflict" });

      const otherDuration = await asUser(db, s.userId, () =>
        create(db, {
          serviceId: s.serviceId,
          startAt,
          requestId,
          durationMin: 30,
        }),
      );
      expect(otherDuration).toEqual({ ok: false, reason: "request_conflict" });
    });
  });

  it("otkazan termin se ne vraća kao ponavljanje", async () => {
    await withRollback(async (db) => {
      const s = await salon(db);
      const requestId = randomUUID();
      const startAt = futureStartAt();

      const first = await asUser(db, s.userId, () =>
        create(db, { serviceId: s.serviceId, startAt, requestId }),
      );
      await db.query(
        "update appointments set status = 'cancelled_by_salon' where id = $1",
        [first.ok && first.appointment_id],
      );

      const again = await asUser(db, s.userId, () =>
        create(db, { serviceId: s.serviceId, startAt, requestId }),
      );

      expect(again).toEqual({ ok: false, reason: "request_conflict" });
    });
  });

  it("request_id drugog salona ništa ne otkriva i ne smeta", async () => {
    await withRollback(async (db) => {
      const a = await salon(db);
      const b = await salon(db);
      const requestId = randomUUID();
      const startAt = futureStartAt();

      await asUser(db, a.userId, () =>
        create(db, { serviceId: a.serviceId, startAt, requestId }),
      );
      const other = await asUser(db, b.userId, () =>
        create(db, { serviceId: b.serviceId, startAt, requestId }),
      );

      expect(other.ok && !("replayed" in other)).toBe(true);
    });
  });
});

describe("ručni unos: istovremeni zahtevi sa istim request_id", () => {
  it("5 paralelnih zahteva daje jedan termin, svi dobijaju isti", async () => {
    const committed = await createCommittedSalon(15, 15);
    let userId: string | null = null;

    try {
      userId = (
        await racePool.query<{ id: string }>(
          "insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id",
          [`trka-${randomUUID()}@primer.rs`],
        )
      ).rows[0]!.id;
      await racePool.query(
        "insert into memberships (user_id, tenant_id, role) values ($1, $2, 'owner')",
        [userId, committed.tenantId],
      );

      const requestId = randomUUID();
      const startAt = new Date(Date.now() + 9 * 24 * 3600 * 1000).toISOString();

      const results = await Promise.all(
        Array.from({ length: 5 }, async () => {
          const db = await racePool.connect();
          try {
            await db.query("begin");
            await db.query("select set_config('request.jwt.claims', $1, true)", [
              JSON.stringify({ sub: userId, role: "authenticated" }),
            ]);
            await db.query("set local role authenticated");
            const result = await db.query<{ r: WriteResult }>(
              "select create_appointment($1, $2, 15, 'Jelena', '+381641234567', null, $3) as r",
              [committed.serviceId, startAt, requestId],
            );
            await db.query("commit");
            return result.rows[0]!.r;
          } catch (error) {
            await db.query("rollback");
            throw error;
          } finally {
            db.release();
          }
        }),
      );

      expect(results.every((result) => result.ok)).toBe(true);
      expect(
        new Set(results.map((r) => (r.ok ? r.appointment_id : null))).size,
      ).toBe(1);
      expect(results.filter((r) => r.ok && !r.replayed)).toHaveLength(1);
    } finally {
      // Upisano je stvarno (trka traži prave transakcije), pa mora i da se
      // ukloni: `seed.test.ts` broji sve korisnike u bazi.
      await cleanupSalon(committed);
      if (userId !== null) {
        await racePool.query("delete from auth.users where id = $1", [userId]);
      }
    }
  });
});
