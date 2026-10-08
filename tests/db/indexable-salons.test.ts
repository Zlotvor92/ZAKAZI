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

type Opened = { slug: string; tenantId: string; serviceId: string };

/** Salon sa izvođačem, uslugom koju izvođač radi i otvorenom stranom. */
async function openSalon(db: pg.PoolClient): Promise<Opened> {
  const tenantId = await createTenant(db);
  const staffId = await createStaff(db, tenantId);
  const serviceId = await createService(db, tenantId);
  await db.query(
    "insert into staff_services (tenant_id, staff_id, service_id) values ($1, $2, $3)",
    [tenantId, staffId, serviceId],
  );
  const slug = (
    await db.query<{ slug: string }>("select slug from tenants where id = $1", [
      tenantId,
    ])
  ).rows[0]!.slug;

  return { slug, tenantId, serviceId };
}

async function listed(db: pg.PoolClient): Promise<string[]> {
  const result = await asServer(db, () =>
    db.query<{ slug: string }>("select slug from indexable_salons()"),
  );
  return result.rows.map((row) => row.slug);
}

/** Da li javna strana tog salona zaista nudi zakazivanje. */
async function pageIsOpen(db: pg.PoolClient, slug: string): Promise<boolean> {
  const result = await db.query<{ data: { services: unknown[] } | null }>(
    "select public_booking_data($1) as data",
    [slug],
  );
  const data = result.rows[0]!.data;
  return data !== null && data.services.length > 0;
}

describe("mapa sajta: indexable_salons", () => {
  it("otvoren salon sa uslugom je u mapi", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);

      expect(await listed(db)).toContain(salon.slug);
      expect(await pageIsOpen(db, salon.slug)).toBe(true);
    });
  });

  const closers: [string, (db: pg.PoolClient, salon: Opened) => Promise<void>][] =
    [
      [
        "zakazivanje ručno isključeno",
        (db, s) =>
          db
            .query("update tenants set public_booking_enabled = false where id = $1", [s.tenantId])
            .then(() => undefined),
      ],
      [
        "salon pauziran",
        (db, s) =>
          db
            .query("update tenants set suspended_at = now() where id = $1", [s.tenantId])
            .then(() => undefined),
      ],
      [
        "pristup istekao",
        (db, s) =>
          db
            .query("update tenants set paid_until = current_date - 10 where id = $1", [s.tenantId])
            .then(() => undefined),
      ],
      [
        "jedina usluga je ugašena",
        (db, s) =>
          db
            .query("update services set active = false where id = $1", [s.serviceId])
            .then(() => undefined),
      ],
      [
        "izvođač ne radi nijednu uslugu",
        (db, s) =>
          db
            .query("delete from staff_services where service_id = $1", [s.serviceId])
            .then(() => undefined),
      ],
    ];

  it.each(closers)("nije u mapi kad je %s — i strana je tada zatvorena", async (_name, close) => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);

      await close(db, salon);

      expect(await listed(db)).not.toContain(salon.slug);
      // Mapa i strana se ne razilaze.
      expect(await pageIsOpen(db, salon.slug)).toBe(false);
    });
  });

  it("pristup koji još važi (datum u budućnosti) ne isključuje salon", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);
      await db.query("update tenants set paid_until = current_date + 30 where id = $1", [
        salon.tenantId,
      ]);

      expect(await listed(db)).toContain(salon.slug);
      expect(await pageIsOpen(db, salon.slug)).toBe(true);
    });
  });

  it("zovu je samo server: ni neulogovan ni prijavljen ne vide spisak", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);
      const userId = await createUser(db, salon.tenantId);

      await asAnon(db, async () => {
        await expect(
          inSavepoint(db, () => db.query("select * from indexable_salons()")),
        ).rejects.toThrow(/permission denied/);
      });

      await asUser(db, userId, async () => {
        await expect(
          inSavepoint(db, () => db.query("select * from indexable_salons()")),
        ).rejects.toThrow(/permission denied/);
      });
    });
  });
});
