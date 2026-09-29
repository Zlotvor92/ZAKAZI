import type pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import {
  asAnon,
  asServer,
  asUser,
  closePool,
  createService,
  createStaff,
  createTenant,
  createUser,
  inSavepoint,
  withRollback,
} from "./helpers";

afterAll(closePool);

const TESTER = "+381622280540";
const OTHER = "+381645550099";

type BookResult = { ok: boolean; reason?: string };

/** Salon koji radi ponedeljkom 09–18, termini od sat i po. */
async function openSalon(db: pg.PoolClient) {
  const tenantId = await createTenant(db);
  const userId = await createUser(db, tenantId);
  const staffId = await createStaff(db, tenantId);
  const serviceId = await createService(db, tenantId, 90);
  await db.query(
    "insert into staff_services (tenant_id, staff_id, service_id) values ($1, $2, $3)",
    [tenantId, staffId, serviceId],
  );
  await db.query(
    `insert into working_hours
       (tenant_id, staff_id, weekday, start_time, end_time, slot_minutes)
     values ($1, $2, 1, '09:00', '18:00', 90)`,
    [tenantId, staffId],
  );
  await db.query(
    `update tenants set booking_horizon_days = 90, min_lead_minutes = 0,
       public_booking_enabled = true where id = $1`,
    [tenantId],
  );
  const slug = await db.query<{ slug: string }>(
    "select slug from tenants where id = $1",
    [tenantId],
  );
  return { tenantId, userId, serviceId, slug: slug.rows[0]!.slug };
}

type Salon = Awaited<ReturnType<typeof openSalon>>;

async function exempt(db: pg.PoolClient, salon: Salon, phone: string) {
  await db.query(
    "insert into limit_exempt_phones (tenant_id, phone_e164, note) values ($1, $2, 'test')",
    [salon.tenantId, phone],
  );
}

async function monday(db: pg.PoolClient, time: string): Promise<string> {
  const result = await db.query<{ at: string }>(
    `select to_char(
       (date_trunc('week', (now() at time zone 'Europe/Belgrade')::date + 14)::date
         + $1::time) at time zone 'Europe/Belgrade',
       'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM') as at`,
    [time],
  );
  return result.rows[0]!.at;
}

/** Tri termina istog ponedeljka, sa istog uređaja, jedan za drugim. */
async function bookThree(db: pg.PoolClient, salon: Salon, phone: string) {
  const results: BookResult[] = [];
  for (const time of ["09:00", "10:30", "12:00"]) {
    const at = await monday(db, time);
    results.push(
      await asAnon(db, async () => {
        const result = await asServer(db, () =>
db.query<{ result: BookResult }>(
          "select public_book($1, $2, $3, 'Test', $4, 'isti-telefon', null) as result",
          [salon.slug, salon.serviceId, at, phone],
        ));
        return result.rows[0]!.result;
      }),
    );
  }
  return results;
}

describe("broj bez ograničenja", () => {
  it("izuzet broj zakazuje mimo nedeljnog limita i pauze od pola minuta", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);
      await exempt(db, salon, TESTER);

      const results = await bookThree(db, salon, TESTER);

      expect(results.map((result) => result.ok)).toEqual([true, true, true]);
    });
  });

  it("običan broj i dalje udara u ograničenja", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);
      await exempt(db, salon, TESTER);

      const results = await bookThree(db, salon, OTHER);

      expect(results[0]!.ok).toBe(true);
      expect(results[1]).toEqual({ ok: false, reason: "too_fast" });
    });
  });

  it("izuzetak važi samo u salonu za koji je upisan", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);
      const other = await openSalon(db);
      await exempt(db, other, TESTER);

      const results = await bookThree(db, salon, TESTER);

      expect(results[1]).toEqual({ ok: false, reason: "too_fast" });
    });
  });

  it("blokiran broj ostaje blokiran", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);
      await exempt(db, salon, TESTER);
      await db.query(
        "insert into blocklist (tenant_id, phone_e164, reason) values ($1, $2, 'test')",
        [salon.tenantId, TESTER],
      );

      const results = await bookThree(db, salon, TESTER);

      expect(results[0]).toEqual({ ok: false, reason: "blocked" });
    });
  });

  it("pretraga termina sa zaključane mreže radi za izuzet broj", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);
      await exempt(db, salon, TESTER);
      await db.query(
        `insert into phone_lookup_attempts (tenant_id, network_hash)
         select $1, 'mreza' from generate_series(1, 25)`,
        [salon.tenantId],
      );

      const limit = (phone: string) =>
        db.query<{ reason: string | null }>(
          "select phone_lookup_limit_reason($1, 'mreza', $2) as reason",
          [salon.tenantId, phone],
        );

      expect((await limit(TESTER)).rows[0]!.reason).toBeNull();
      expect((await limit(OTHER)).rows[0]!.reason).toBe("too_many_lookups");
    });
  });
});

describe("spisak izuzetih brojeva", () => {
  it("ne vidi ga ni vlasnica salona ni neprijavljen posetilac", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);
      await exempt(db, salon, TESTER);

      await asUser(db, salon.userId, async () => {
        await expect(
          inSavepoint(db, () => db.query("select * from limit_exempt_phones")),
        ).rejects.toThrow(/permission denied/i);
      });
      await asAnon(db, async () => {
        await expect(
          inSavepoint(db, () => db.query("select * from limit_exempt_phones")),
        ).rejects.toThrow(/permission denied/i);
      });
    });
  });

  it("vlasnica ne može sama sebi da upiše izuzetak", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);

      await asUser(db, salon.userId, async () => {
        await expect(
          inSavepoint(db, () =>
            db.query(
              "insert into limit_exempt_phones (tenant_id, phone_e164) values ($1, $2)",
              [salon.tenantId, TESTER],
            ),
          ),
        ).rejects.toThrow(/permission denied/i);
      });
    });
  });
});
