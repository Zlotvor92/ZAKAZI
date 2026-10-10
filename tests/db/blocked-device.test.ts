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
  withRollback,
} from "./helpers";

afterAll(closePool);

const TESTER = "+381622280540";
const OTHER = "+381645550099";

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

type Booking = { ok: boolean; reason?: string };

async function book(
  db: pg.PoolClient,
  salon: Salon,
  phone: string,
  device: string,
  time: string,
): Promise<Booking> {
  const at = await monday(db, time);
  return asAnon(db, async () => {
    const result = await asServer(db, () =>
      db.query<{ result: Booking }>(
        "select public_book($1, $2, $3, 'Test', $4, $5, null) as result",
        [salon.slug, salon.serviceId, at, phone, device],
      ),
    );
    return result.rows[0]!.result;
  });
}

async function block(db: pg.PoolClient, salon: Salon, phone: string) {
  await db.query(
    "insert into blocklist (tenant_id, phone_e164, reason) values ($1, $2, 'test')",
    [salon.tenantId, phone],
  );
}

describe("blokiran broj blokira i uređaj", () => {
  it("drugi broj sa istog uređaja je blokiran, sa drugog uređaja nije", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);
      expect((await book(db, salon, TESTER, "uredjaj-a", "09:00")).ok).toBe(true);
      await block(db, salon, TESTER);

      expect(await book(db, salon, OTHER, "uredjaj-a", "10:30")).toEqual({
        ok: false,
        reason: "blocked",
      });
      expect((await book(db, salon, OTHER, "uredjaj-b", "10:30")).ok).toBe(true);
    });
  });

  it("odblokiran broj odblokira i uređaj", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);
      await book(db, salon, TESTER, "uredjaj-a", "09:00");
      await block(db, salon, TESTER);
      await db.query("delete from blocklist where tenant_id = $1", [salon.tenantId]);

      // Pauza od pola minuta po uređaju je drugo pravilo; ovde je bitno da nije blokiran.
      expect((await book(db, salon, OTHER, "uredjaj-a", "10:30")).reason).not.toBe(
        "blocked",
      );
    });
  });

  it("važi samo u salonu u kom je broj blokiran", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);
      const other = await openSalon(db);
      await book(db, salon, TESTER, "uredjaj-a", "09:00");
      await block(db, salon, TESTER);

      expect((await book(db, other, OTHER, "uredjaj-a", "09:00")).ok).toBe(true);
    });
  });

  it("izuzet broj ne pada zbog uređaja", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);
      await book(db, salon, TESTER, "uredjaj-a", "09:00");
      await block(db, salon, TESTER);
      await exempt(db, salon, OTHER);

      expect((await book(db, salon, OTHER, "uredjaj-a", "10:30")).ok).toBe(true);
    });
  });
});
