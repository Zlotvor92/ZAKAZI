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

const PHONE = "+381645551122";

type BookResult =
  | { ok: true; appointment: { id: string } }
  | {
      ok: false;
      reason: string;
      window_days?: number;
      required_service_name?: string;
    };

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

/** Salon sa nadogradnjom i korekcijom koja važi 21 dan od jedne od njih. */
async function lashSalon(db: pg.PoolClient) {
  const tenantId = await createTenant(db);
  const userId = await createUser(db, tenantId);
  const staffId = await createStaff(db, tenantId);
  const fullSet = await service(db, tenantId, staffId, "Nadogradnja trepavica", 120);
  const refill = await service(db, tenantId, staffId, "Korekcija trepavica", 90);
  const nails = await service(db, tenantId, staffId, "Gel nokti", 90);

  await db.query(
    "update services set requires_service_id = $2, requires_within_days = 21 where id = $1",
    [refill, fullSet],
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

  return { tenantId, userId, staffId, fullSet, refill, nails, slug: slug.rows[0]!.slug };
}

type Salon = Awaited<ReturnType<typeof lashSalon>>;

/** Ponedeljak u 09:00, bar šest nedelja unapred, da prošli dolasci stanu pre njega. */
async function targetMonday(db: pg.PoolClient): Promise<string> {
  const result = await db.query<{ at: string }>(
    `select to_char(
       (date_trunc('week', (now() at time zone 'Europe/Belgrade')::date + 42)::date
         + time '09:00') at time zone 'Europe/Belgrade',
       'YYYY-MM-DD"T"HH24:MI:SSOF') as at`,
  );
  return result.rows[0]!.at;
}

/** Raniji dolazak, `daysBefore` dana pre ciljnog ponedeljka. */
async function visit(
  db: pg.PoolClient,
  base: Salon,
  clientId: string,
  serviceId: string,
  target: string,
  daysBefore: number,
  status: "completed" | "confirmed" | "no_show" = "completed",
) {
  const at = await db.query<{ at: string }>(
    "select ($1::timestamptz - make_interval(days => $2)) as at",
    [target, daysBefore],
  );
  await insertAppointment(db, {
    tenantId: base.tenantId,
    staffId: base.staffId,
    serviceId,
    clientId,
    startAt: at.rows[0]!.at,
    status,
  });
}

async function bookRefill(
  db: pg.PoolClient,
  base: Salon,
  target: string,
): Promise<BookResult> {
  return asAnon(db, async () => {
    const result = await db.query<{ result: BookResult }>(
      "select public_book($1, $2, $3, 'Ana', $4, null, null) as result",
      [base.slug, base.refill, target, PHONE],
    );
    return result.rows[0]!.result;
  });
}

describe("korekcija važi 21 dan od poslednjeg dolaska", () => {
  it("20 dana posle nadogradnje korekcija prolazi", async () => {
    await withRollback(async (db) => {
      const base = await lashSalon(db);
      const target = await targetMonday(db);
      const client = await createClient(db, base.tenantId, PHONE);
      await visit(db, base, client, base.fullSet, target, 20);

      expect((await bookRefill(db, base, target)).ok).toBe(true);
    });
  });

  it("22 dana posle nadogradnje korekcija se odbija i nudi se nadogradnja", async () => {
    await withRollback(async (db) => {
      const base = await lashSalon(db);
      const target = await targetMonday(db);
      const client = await createClient(db, base.tenantId, PHONE);
      await visit(db, base, client, base.fullSet, target, 22);

      expect(await bookRefill(db, base, target)).toMatchObject({
        ok: false,
        reason: "service_window",
        window_days: 21,
        required_service_name: "Nadogradnja trepavica",
      });
    });
  });

  it("računa se i poslednja korekcija, ne samo nadogradnja", async () => {
    await withRollback(async (db) => {
      const base = await lashSalon(db);
      const target = await targetMonday(db);
      const client = await createClient(db, base.tenantId, PHONE);
      await visit(db, base, client, base.fullSet, target, 40);
      await visit(db, base, client, base.refill, target, 14);

      expect((await bookRefill(db, base, target)).ok).toBe(true);
    });
  });

  it("dolazak na drugu uslugu ne produžava rok", async () => {
    await withRollback(async (db) => {
      const base = await lashSalon(db);
      const target = await targetMonday(db);
      const client = await createClient(db, base.tenantId, PHONE);
      await visit(db, base, client, base.fullSet, target, 30);
      await visit(db, base, client, base.nails, target, 5);

      expect((await bookRefill(db, base, target)).ok).toBe(false);
    });
  });

  it("izostanak se ne računa kao dolazak", async () => {
    await withRollback(async (db) => {
      const base = await lashSalon(db);
      const target = await targetMonday(db);
      const client = await createClient(db, base.tenantId, PHONE);
      await visit(db, base, client, base.fullSet, target, 30);
      await visit(db, base, client, base.fullSet, target, 7, "no_show");

      expect((await bookRefill(db, base, target)).ok).toBe(false);
    });
  });

  it("već zakazana nadogradnja pre korekcije se računa", async () => {
    await withRollback(async (db) => {
      const base = await lashSalon(db);
      const target = await targetMonday(db);
      const client = await createClient(db, base.tenantId, PHONE);
      await visit(db, base, client, base.fullSet, target, 60);
      await visit(db, base, client, base.fullSet, target, 14, "confirmed");

      expect((await bookRefill(db, base, target)).ok).toBe(true);
    });
  });

  it("broj koji salon nikad nije video prolazi", async () => {
    await withRollback(async (db) => {
      const base = await lashSalon(db);
      const target = await targetMonday(db);

      expect((await bookRefill(db, base, target)).ok).toBe(true);
    });
  });

  it("usluga bez pravila se zakazuje bez obzira na istoriju", async () => {
    await withRollback(async (db) => {
      const base = await lashSalon(db);
      const target = await targetMonday(db);
      const client = await createClient(db, base.tenantId, PHONE);
      await visit(db, base, client, base.fullSet, target, 90);

      const result = await asAnon(db, async () => {
        const booked = await db.query<{ result: BookResult }>(
          "select public_book($1, $2, $3, 'Ana', $4, null, null) as result",
          [base.slug, base.fullSet, target, PHONE],
        );
        return booked.rows[0]!.result;
      });

      expect(result.ok).toBe(true);
    });
  });
});

describe("podešavanje pravila", () => {
  async function saveRule(
    db: pg.PoolClient,
    base: Salon,
    requiresServiceId: string | null,
    days: number | null,
  ) {
    return asUser(db, base.userId, async () => {
      const result = await db.query<{ result: { ok: boolean; reason?: string } }>(
        `select upsert_service($1, 'Korekcija trepavica', 90, 2200, null, null, $2, $3)
           as result`,
        [base.refill, requiresServiceId, days],
      );
      return result.rows[0]!.result;
    });
  }

  it("čuva se, i briše kad se oba polja isprazne", async () => {
    await withRollback(async (db) => {
      const base = await lashSalon(db);

      expect(await saveRule(db, base, base.fullSet, 28)).toEqual({
        ok: true,
        id: base.refill,
      });
      expect(await saveRule(db, base, null, null)).toMatchObject({ ok: true });

      const row = await db.query(
        "select requires_service_id, requires_within_days from services where id = $1",
        [base.refill],
      );
      expect(row.rows[0]).toEqual({
        requires_service_id: null,
        requires_within_days: null,
      });
    });
  });

  it("odbija pola pravila, nemoguće dane, samu sebe i tuđu uslugu", async () => {
    await withRollback(async (db) => {
      const base = await lashSalon(db);
      const other = await lashSalon(db);
      const invalid = { ok: false, reason: "invalid_window" };

      expect(await saveRule(db, base, base.fullSet, null)).toEqual(invalid);
      expect(await saveRule(db, base, null, 21)).toEqual(invalid);
      expect(await saveRule(db, base, base.fullSet, 0)).toEqual(invalid);
      expect(await saveRule(db, base, base.refill, 21)).toEqual(invalid);
      expect(await saveRule(db, base, other.fullSet, 21)).toEqual(invalid);
    });
  });

  it("brisanje usluge na koju pravilo pokazuje ne puca", async () => {
    await withRollback(async (db) => {
      const base = await lashSalon(db);

      await asUser(db, base.userId, () =>
        db.query("select remove_service($1)", [base.fullSet]),
      );

      const row = await db.query<{ requires_service_id: string | null }>(
        "select requires_service_id from services where id = $1",
        [base.refill],
      );
      expect(row.rows[0]!.requires_service_id).toBeNull();
    });
  });
});

describe("provera za vlasnicu", () => {
  it("vlasnica dobija isti razlog, a drugi salon ništa", async () => {
    await withRollback(async (db) => {
      const base = await lashSalon(db);
      const other = await lashSalon(db);
      const target = await targetMonday(db);
      const client = await createClient(db, base.tenantId, PHONE);
      await visit(db, base, client, base.fullSet, target, 30);

      const check = (userId: string) =>
        asUser(db, userId, async () => {
          const result = await db.query<{ problem: unknown }>(
            "select service_window_problem($1, $2, $3, $4) as problem",
            [base.refill, PHONE, base.tenantId, target],
          );
          return result.rows[0]!.problem;
        });

      expect(await check(base.userId)).toMatchObject({ window_days: 21 });
      expect(await check(other.userId)).toBeNull();
    });
  });

  it("neprijavljen posetilac ne može direktno da pita", async () => {
    await withRollback(async (db) => {
      const base = await lashSalon(db);
      const target = await targetMonday(db);

      await asAnon(db, async () => {
        await expect(
          inSavepoint(db, () =>
            db.query("select service_window_problem($1, $2, $3, $4)", [
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
