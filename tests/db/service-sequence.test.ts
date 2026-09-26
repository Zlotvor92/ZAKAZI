import type pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import {
  asAnon,
  asUser,
  closePool,
  createClient,
  createStaff,
  createTenant,
  createUser,
  inSavepoint,
  insertAppointment,
  withRollback,
} from "./helpers";

afterAll(closePool);

const PHONE = "+381645551133";

type BookResult =
  | { ok: true; appointment: { id: string } }
  | { ok: false; reason: string; [key: string]: unknown };

async function service(
  db: pg.PoolClient,
  tenantId: string,
  staffId: string,
  name: string,
  minutes: number,
): Promise<string> {
  const result = await db.query<{ id: string }>(
    `insert into services (tenant_id, name, duration_min, price_rsd)
     values ($1, $2, $3, 3000) returning id`,
    [tenantId, name, minutes],
  );
  const id = result.rows[0]!.id;
  await db.query(
    "insert into staff_services (tenant_id, staff_id, service_id) values ($1, $2, $3)",
    [tenantId, staffId, id],
  );
  return id;
}

/**
 * Salon kao kod Smiley-ja: korekcija važi 21 dan od nadogradnje i ne može
 * posle skidanja.
 */
async function lashSalon(db: pg.PoolClient) {
  const tenantId = await createTenant(db);
  const userId = await createUser(db, tenantId);
  const staffId = await createStaff(db, tenantId);
  const fullSet = await service(db, tenantId, staffId, "Nadogradnja trepavica", 120);
  const refill = await service(db, tenantId, staffId, "Korekcija trepavica", 90);
  const removal = await service(db, tenantId, staffId, "Skidanje trepavica", 30);
  const nails = await service(db, tenantId, staffId, "Gel nokti", 90);

  await db.query(
    `update services
        set requires_service_id = $2, requires_within_days = 21,
            not_after_service_id = $3
      where id = $1`,
    [refill, fullSet, removal],
  );
  await db.query(
    `insert into working_hours
       (tenant_id, staff_id, weekday, start_time, end_time, slot_minutes)
     select $1, $2, d, '09:00', '18:00', 30 from generate_series(1, 6) d`,
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

  return {
    tenantId,
    userId,
    staffId,
    fullSet,
    refill,
    removal,
    nails,
    slug: slug.rows[0]!.slug,
  };
}

type Salon = Awaited<ReturnType<typeof lashSalon>>;

/** Ponedeljak u 09:00, šest nedelja unapred, pomeren za `days` dana. */
async function at(db: pg.PoolClient, days = 0, hour = "09:00"): Promise<string> {
  const result = await db.query<{ at: string }>(
    `select to_char(
       (date_trunc('week', (now() at time zone 'Europe/Belgrade')::date + 42)::date
         + $1::int + $2::time) at time zone 'Europe/Belgrade',
       'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM') as at`,
    [days, hour],
  );
  return result.rows[0]!.at;
}

async function visit(
  db: pg.PoolClient,
  base: Salon,
  clientId: string,
  serviceId: string,
  startAt: string,
  status: "completed" | "confirmed" | "cancelled_by_client" = "completed",
) {
  await insertAppointment(db, {
    tenantId: base.tenantId,
    staffId: base.staffId,
    serviceId,
    clientId,
    startAt,
    status,
  });
}

async function book(
  db: pg.PoolClient,
  base: Salon,
  serviceId: string,
  startAt: string,
): Promise<BookResult> {
  return asAnon(db, async () => {
    const result = await db.query<{ result: BookResult }>(
      "select public_book($1, $2, $3, 'Ana', $4, null, null) as result",
      [base.slug, serviceId, startAt, PHONE],
    );
    return result.rows[0]!.result;
  });
}

describe("korekcija ne može posle skidanja", () => {
  it("skidanje dan ranije odbija korekciju i šalje na nadogradnju", async () => {
    await withRollback(async (db) => {
      const base = await lashSalon(db);
      const client = await createClient(db, base.tenantId, PHONE);
      await visit(db, base, client, base.fullSet, await at(db, -14));
      await visit(db, base, client, base.removal, await at(db, -1), "confirmed");

      expect(await book(db, base, base.refill, await at(db))).toMatchObject({
        ok: false,
        reason: "service_sequence",
        timezone: "Europe/Belgrade",
        kind: "after",
        service_name: "Korekcija trepavica",
        blocking_service_name: "Skidanje trepavica",
        required_service_name: "Nadogradnja trepavica",
      });
    });
  });

  it("nova nadogradnja posle skidanja ponovo otvara korekciju", async () => {
    await withRollback(async (db) => {
      const base = await lashSalon(db);
      const client = await createClient(db, base.tenantId, PHONE);
      await visit(db, base, client, base.removal, await at(db, -20));
      await visit(db, base, client, base.fullSet, await at(db, -10));

      expect((await book(db, base, base.refill, await at(db))).ok).toBe(true);
    });
  });

  it("važi i za broj koji salon ranije nije video", async () => {
    await withRollback(async (db) => {
      const base = await lashSalon(db);

      // Ponedeljak i utorak: nedeljom salon ne radi.
      expect((await book(db, base, base.removal, await at(db))).ok).toBe(true);
      expect(await book(db, base, base.refill, await at(db, 1))).toMatchObject({
        ok: false,
        reason: "service_sequence",
        kind: "after",
      });
    });
  });

  it("otkazano skidanje se ne računa", async () => {
    await withRollback(async (db) => {
      const base = await lashSalon(db);
      const client = await createClient(db, base.tenantId, PHONE);
      await visit(db, base, client, base.fullSet, await at(db, -14));
      await visit(
        db,
        base,
        client,
        base.removal,
        await at(db, -1),
        "cancelled_by_client",
      );

      expect((await book(db, base, base.refill, await at(db))).ok).toBe(true);
    });
  });

  it("skidanje posle korekcije ne smeta toj korekciji", async () => {
    await withRollback(async (db) => {
      const base = await lashSalon(db);
      const client = await createClient(db, base.tenantId, PHONE);
      await visit(db, base, client, base.fullSet, await at(db, -14));
      await visit(db, base, client, base.removal, await at(db, 3), "confirmed");

      expect((await book(db, base, base.refill, await at(db))).ok).toBe(true);
    });
  });
});

describe("skidanje pred već zakazanu korekciju", () => {
  it("odbija se i kaže koja je korekcija i kada", async () => {
    await withRollback(async (db) => {
      const base = await lashSalon(db);
      const client = await createClient(db, base.tenantId, PHONE);
      const refillAt = await at(db, 1, "10:30");
      await visit(db, base, client, base.refill, refillAt, "confirmed");

      const result = await book(db, base, base.removal, await at(db));

      expect(result).toMatchObject({
        ok: false,
        reason: "service_sequence",
        kind: "before",
        service_name: "Skidanje trepavica",
        later_service_name: "Korekcija trepavica",
      });
      expect(result.ok ? null : new Date(String(result["later_at"]))).toEqual(
        new Date(refillAt),
      );
    });
  });

  it("prolazi kad je između zakazana nadogradnja", async () => {
    await withRollback(async (db) => {
      const base = await lashSalon(db);
      const client = await createClient(db, base.tenantId, PHONE);
      await visit(db, base, client, base.fullSet, await at(db, 1), "confirmed");
      await visit(db, base, client, base.refill, await at(db, 21), "confirmed");

      expect((await book(db, base, base.removal, await at(db))).ok).toBe(true);
    });
  });

  it("skidanje posle korekcije prolazi", async () => {
    await withRollback(async (db) => {
      const base = await lashSalon(db);
      const client = await createClient(db, base.tenantId, PHONE);
      await visit(db, base, client, base.refill, await at(db, -1), "confirmed");

      expect((await book(db, base, base.removal, await at(db))).ok).toBe(true);
    });
  });
});

describe("usluge bez pravila", () => {
  it("salon koji ništa nije podesio ne primećuje razliku", async () => {
    await withRollback(async (db) => {
      const base = await lashSalon(db);
      await db.query("update services set not_after_service_id = null where id = $1", [
        base.refill,
      ]);
      const client = await createClient(db, base.tenantId, PHONE);
      await visit(db, base, client, base.fullSet, await at(db, -14));
      await visit(db, base, client, base.removal, await at(db, -1), "confirmed");

      expect((await book(db, base, base.refill, await at(db))).ok).toBe(true);
    });
  });

  it("druga usluga istog salona ne smeta", async () => {
    await withRollback(async (db) => {
      const base = await lashSalon(db);
      const client = await createClient(db, base.tenantId, PHONE);
      await visit(db, base, client, base.refill, await at(db, 1), "confirmed");

      expect((await book(db, base, base.nails, await at(db))).ok).toBe(true);
    });
  });
});

describe("podešavanje pravila", () => {
  async function saveRule(
    db: pg.PoolClient,
    base: Salon,
    requiresServiceId: string | null,
    days: number | null,
    notAfterServiceId: string | null,
  ) {
    return asUser(db, base.userId, async () => {
      const result = await db.query<{ result: { ok: boolean; reason?: string } }>(
        `select upsert_service($1, 'Korekcija trepavica', 90, 2200, null, null, $2, $3, $4)
           as result`,
        [base.refill, requiresServiceId, days, notAfterServiceId],
      );
      return result.rows[0]!.result;
    });
  }

  it("čuva se i briše", async () => {
    await withRollback(async (db) => {
      const base = await lashSalon(db);

      expect(await saveRule(db, base, base.fullSet, 21, base.removal)).toEqual({
        ok: true,
        id: base.refill,
      });
      expect(await saveRule(db, base, base.fullSet, 21, null)).toMatchObject({
        ok: true,
      });

      const row = await db.query(
        "select not_after_service_id from services where id = $1",
        [base.refill],
      );
      expect(row.rows[0]).toEqual({ not_after_service_id: null });
    });
  });

  it("odbija pravilo bez roka, samu sebe, uslugu iz roka i tuđu uslugu", async () => {
    await withRollback(async (db) => {
      const base = await lashSalon(db);
      const other = await lashSalon(db);
      const invalid = { ok: false, reason: "invalid_not_after" };

      expect(await saveRule(db, base, null, null, base.removal)).toEqual(invalid);
      expect(await saveRule(db, base, base.fullSet, 21, base.refill)).toEqual(invalid);
      expect(await saveRule(db, base, base.fullSet, 21, base.fullSet)).toEqual(invalid);
      expect(await saveRule(db, base, base.fullSet, 21, other.removal)).toEqual(invalid);
    });
  });

  it("brisanje skidanja gasi pravilo, ne puca", async () => {
    await withRollback(async (db) => {
      const base = await lashSalon(db);

      await asUser(db, base.userId, () =>
        db.query("select remove_service($1)", [base.removal]),
      );

      const row = await db.query<{ not_after_service_id: string | null }>(
        "select not_after_service_id from services where id = $1",
        [base.refill],
      );
      expect(row.rows[0]!.not_after_service_id).toBeNull();
    });
  });

  it("spisak usluga vraća pravilo", async () => {
    await withRollback(async (db) => {
      const base = await lashSalon(db);

      const rows = await asUser(db, base.userId, async () => {
        const result = await db.query<{ id: string; not_after_service_id: string | null }>(
          "select id, not_after_service_id from tenant_services($1)",
          [base.tenantId],
        );
        return result.rows;
      });

      expect(rows.find((row) => row.id === base.refill)?.not_after_service_id).toBe(
        base.removal,
      );
    });
  });
});

describe("provera za vlasnicu", () => {
  it("vlasnica dobija razlog, a drugi salon ništa", async () => {
    await withRollback(async (db) => {
      const base = await lashSalon(db);
      const other = await lashSalon(db);
      const client = await createClient(db, base.tenantId, PHONE);
      await visit(db, base, client, base.removal, await at(db, -1), "confirmed");
      const target = await at(db);

      const check = (userId: string) =>
        asUser(db, userId, async () => {
          const result = await db.query<{ problem: unknown }>(
            "select service_sequence_problem($1, $2, $3, $4) as problem",
            [base.refill, PHONE, base.tenantId, target],
          );
          return result.rows[0]!.problem;
        });

      expect(await check(base.userId)).toMatchObject({ kind: "after" });
      expect(await check(other.userId)).toBeNull();
    });
  });

  it("neprijavljen posetilac ne može direktno da pita", async () => {
    await withRollback(async (db) => {
      const base = await lashSalon(db);
      const target = await at(db);

      await asAnon(db, async () => {
        await expect(
          inSavepoint(db, () =>
            db.query("select service_sequence_problem($1, $2, $3, $4)", [
              base.refill,
              PHONE,
              base.tenantId,
              target,
            ]),
          ),
        ).rejects.toThrow(/permission denied/i);
      });
    });
  });
});
