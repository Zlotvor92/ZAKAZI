import type pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import {
  asAnon,
  asServer,
  closePool,
  createService,
  createStaff,
  createTenant,
  createUser,
  inSavepoint,
  withRollback,
} from "./helpers";

afterAll(closePool);

type Result = { ok: boolean; reason?: string };

async function salon(db: pg.PoolClient) {
  const tenantId = await createTenant(db);
  const userId = await createUser(db, tenantId);
  const staffId = await createStaff(db, tenantId);
  const serviceId = await createService(db, tenantId, 60);
  await db.query(
    "insert into staff_services (tenant_id, staff_id, service_id) values ($1,$2,$3)",
    [tenantId, staffId, serviceId],
  );
  for (const weekday of [1, 2, 3, 4, 5, 6, 7]) {
    await db.query(
      `insert into working_hours (tenant_id, staff_id, weekday, start_time, end_time, slot_minutes)
       values ($1,$2,$3,'09:00','18:00',60)`,
      [tenantId, staffId, weekday],
    );
  }
  await db.query(
    "update tenants set min_lead_minutes = 0, booking_horizon_days = 30 where id = $1",
    [tenantId],
  );
  const { rows } = await db.query<{ slug: string }>("select slug from tenants where id = $1", [tenantId]);
  return { tenantId, userId, staffId, serviceId, slug: rows[0]!.slug };
}

async function day(db: pg.PoolClient, offset: number): Promise<string> {
  const { rows } = await db.query<{ d: string }>(
    "select ((now() at time zone 'Europe/Belgrade')::date + $1::int)::text as d",
    [offset],
  );
  return rows[0]!.d;
}

async function book(
  db: pg.PoolClient,
  s: { slug: string; serviceId: string },
  startSql: string,
  params: unknown[],
  phone: string,
): Promise<Result> {
  return asServer(db, async () =>
    (
      await db.query<{ r: Result }>(
        `select public_book($1, $2, ${startSql}, 'Test', $${params.length + 3}, null, null) as r`,
        [s.slug, s.serviceId, ...params, phone],
      )
    ).rows[0]!.r,
  );
}

const WITH_ZERO = "+381064123456";
const CANONICAL = "+38164123456";

describe("srpski broj je kanonski: bez nule posle +381", () => {
  it("broj sa nulom se odbija kao nevažeći, kanonski prolazi", async () => {
    await withRollback(async (db) => {
      const s = await salon(db);
      const d = await day(db, 3);
      const at = "(($3::date + time '10:00') at time zone 'Europe/Belgrade')";

      expect(await book(db, s, at, [d], WITH_ZERO)).toEqual({ ok: false, reason: "invalid_phone" });
      expect((await book(db, s, at, [d], CANONICAL)).ok).toBe(true);
    });
  });

  it("blokiran broj se ne zaobilazi upisom nule", async () => {
    await withRollback(async (db) => {
      const s = await salon(db);
      await db.query(
        "insert into blocklist (tenant_id, phone_e164, reason, created_by) values ($1,$2,'test',$3)",
        [s.tenantId, CANONICAL, s.userId],
      );
      const d = await day(db, 3);
      const at = "(($3::date + time '10:00') at time zone 'Europe/Belgrade')";

      expect((await book(db, s, at, [d], CANONICAL)).reason).toBe("blocked");
      expect((await book(db, s, at, [d], WITH_ZERO)).reason).toBe("invalid_phone");
    });
  });

  it("pretraga i otkazivanje ne prihvataju broj sa nulom", async () => {
    await withRollback(async (db) => {
      const s = await salon(db);
      await asServer(db, async () => {
        const found = await db.query<{ r: unknown[] }>(
          "select public_appointments_for_phone($1, $2, 'h') as r",
          [s.slug, WITH_ZERO],
        );
        expect(found.rows[0]!.r).toEqual([]);

        const cancelled = await db.query<{ r: Result }>(
          "select public_cancel_appointment($1, $2, gen_random_uuid(), null, 'h') as r",
          [s.slug, WITH_ZERO],
        );
        expect(cancelled.rows[0]!.r).toEqual({ ok: false, reason: "invalid_phone" });
      });
    });
  });

  it("nov klijent i izuzeti broj sa nulom ne mogu da se upišu", async () => {
    await withRollback(async (db) => {
      const s = await salon(db);
      await expect(
        inSavepoint(db, () =>
          db.query("insert into clients (tenant_id, name, phone_e164) values ($1,'A',$2)", [s.tenantId, WITH_ZERO]),
        ),
      ).rejects.toThrow(/clients_phone_e164_format/);
      await expect(
        inSavepoint(db, () =>
          db.query("insert into limit_exempt_phones (tenant_id, phone_e164) values ($1,$2)", [s.tenantId, WITH_ZERO]),
        ),
      ).rejects.toThrow(/limit_exempt_phones_phone_e164_check/);
    });
  });
});

describe("početak termina mora biti na celom minutu", () => {
  const cases: [string, string, boolean][] = [
    ["tačno 10:00:00", "interval '0 seconds'", true],
    ["10:00:00.4", "interval '0.4 seconds'", false],
    ["10:00:00.001", "interval '0.001 seconds'", false],
    ["10:00:30", "interval '30 seconds'", false],
  ];

  for (const [name, offset, accepted] of cases) {
    it(`${name} ${accepted ? "prolazi" : "se odbija"}`, async () => {
      await withRollback(async (db) => {
        const s = await salon(db);
        const d = await day(db, 4);
        const result = await book(
          db,
          s,
          `((($3::date + time '10:00') at time zone 'Europe/Belgrade') + ${offset})`,
          [d],
          CANONICAL,
        );

        expect(result.ok).toBe(accepted);
        if (!accepted) {
          expect(result.reason).toBe("outside_working_hours");
        }
      });
    });
  }

  it("odbijen razlomak ne blokira susedni termin", async () => {
    await withRollback(async (db) => {
      const s = await salon(db);
      const d = await day(db, 4);
      await book(db, s, "((($3::date + time '10:00') at time zone 'Europe/Belgrade') + interval '0.4 seconds')", [d], CANONICAL);

      const next = await book(db, s, "(($3::date + time '11:00') at time zone 'Europe/Belgrade')", [d], "+381645123480");
      const same = await book(db, s, "(($3::date + time '10:00') at time zone 'Europe/Belgrade')", [d], "+381645123481");

      expect(next.ok).toBe(true);
      expect(same.ok).toBe(true);
    });
  });
});

describe("čišćenje phone_lookup_attempts", () => {
  it("briše zapise starije od dana, ostavlja skorašnje", async () => {
    await withRollback(async (db) => {
      const s = await salon(db);
      await db.query(
        `insert into phone_lookup_attempts (tenant_id, network_hash, created_at)
         values ($1,'a', now() - interval '2 days'),
                ($1,'b', now() - interval '25 hours'),
                ($1,'c', now() - interval '23 hours'),
                ($1,'d', now())`,
        [s.tenantId],
      );

      const pruned = await asServer(db, async () =>
        (await db.query<{ n: number }>("select prune_phone_lookup_attempts() as n")).rows[0]!.n,
      );

      expect(pruned).toBe(2);
      const left = await db.query<{ network_hash: string }>(
        "select network_hash from phone_lookup_attempts order by network_hash",
      );
      expect(left.rows.map((r) => r.network_hash)).toEqual(["c", "d"]);
    });
  });

  it("čišćenje ne može da pozove anon", async () => {
    await withRollback(async (db) => {
      await asAnon(db, async () => {
        await expect(
          inSavepoint(db, () => db.query("select prune_phone_lookup_attempts()")),
        ).rejects.toThrow(/permission denied/);
      });
    });
  });
});
