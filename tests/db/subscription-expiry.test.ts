import type pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import {
  asAnon,
  closePool,
  createClient,
  createService,
  createStaff,
  createTenant,
  insertAppointment,
  withRollback,
} from "./helpers";

afterAll(closePool);

async function slugOf(db: pg.PoolClient, tenantId: string): Promise<string> {
  const result = await db.query<{ slug: string }>(
    "select slug from tenants where id = $1",
    [tenantId],
  );
  return result.rows[0]!.slug;
}

async function setPaidUntil(
  db: pg.PoolClient,
  tenantId: string,
  value: string | null,
): Promise<void> {
  await db.query("update tenants set paid_until = $2 where id = $1", [
    tenantId,
    value,
  ]);
}

async function bookingPage(
  db: pg.PoolClient,
  slug: string,
): Promise<unknown | null> {
  const result = await db.query<{ data: unknown | null }>(
    "select public_booking_data($1) as data",
    [slug],
  );
  return result.rows[0]!.data;
}

/** Salon spreman da primi zakazivanje: usluga, izvođač i radno vreme. */
async function openSalon(db: pg.PoolClient): Promise<{
  tenantId: string;
  slug: string;
}> {
  const tenantId = await createTenant(db);
  const staffId = await createStaff(db, tenantId);
  const serviceId = await createService(db, tenantId);

  await db.query(
    "insert into staff_services (tenant_id, staff_id, service_id) values ($1, $2, $3)",
    [tenantId, staffId, serviceId],
  );

  return { tenantId, slug: await slugOf(db, tenantId) };
}

describe("računanje isteka", () => {
  it("prazan datum nikad ne ističe — probni period se ne gasi sam", async () => {
    await withRollback(async (db) => {
      const result = await db.query<{ expired: boolean }>(
        "select subscription_expired(null, 'Europe/Belgrade') as expired",
      );
      expect(result.rows[0]!.expired).toBe(false);
    });
  });

  it("poslednji plaćeni dan još uvek radi", async () => {
    await withRollback(async (db) => {
      const result = await db.query<{ expired: boolean }>(
        `select subscription_expired(
           (now() at time zone 'Europe/Belgrade')::date, 'Europe/Belgrade'
         ) as expired`,
      );
      expect(result.rows[0]!.expired).toBe(false);
    });
  });

  it("juče je isteklo", async () => {
    await withRollback(async (db) => {
      const result = await db.query<{ expired: boolean }>(
        `select subscription_expired(
           (now() at time zone 'Europe/Belgrade')::date - 1, 'Europe/Belgrade'
         ) as expired`,
      );
      expect(result.rows[0]!.expired).toBe(true);
    });
  });

  it("dan se meri po salonu, ne po serveru", async () => {
    await withRollback(async (db) => {
      // Ranije su ovde stajali Kiritimati i Beograd, sa `now()`. Njih dvoje
      // deli dvanaest sati, pa im se datum razlikuje samo dok je UTC sat
      // između 10 i 22 — test je prolazio pola dana, a padao drugu polovinu.
      //
      // Etc/GMT+12 i Kiritimati dele dvadeset šest sati i nijedan nema letnje
      // računanje vremena, pa im se datum ne poklopi nijednog sata u godini.
      // Isti `paid_until` je zato uvek istekao na jednoj strani, a na drugoj
      // nije — bez obzira kad se test pokrene.
      const result = await db.query<{ istok: boolean; zapad: boolean }>(
        `select
           subscription_expired(
             (now() at time zone 'Etc/GMT+12')::date, 'Pacific/Kiritimati') as istok,
           subscription_expired(
             (now() at time zone 'Etc/GMT+12')::date, 'Etc/GMT+12') as zapad`,
      );

      // Na istoku je taj dan odavno prošao; na zapadu je upravo taj dan.
      expect(result.rows[0]!.istok).toBe(true);
      expect(result.rows[0]!.zapad).toBe(false);
    });
  });

  it("prazna tajmzona pada na Beograd umesto da vrati ništa", async () => {
    await withRollback(async (db) => {
      const result = await db.query<{ expired: boolean }>(
        "select subscription_expired(current_date - 5, '') as expired",
      );
      expect(result.rows[0]!.expired).toBe(true);
    });
  });
});

describe("istekla pretplata gasi novo zakazivanje", () => {
  it("salon sa važećom pretplatom prima zakazivanje", async () => {
    await withRollback(async (db) => {
      const { tenantId, slug } = await openSalon(db);
      await setPaidUntil(db, tenantId, "2099-01-01");

      expect(await asAnon(db, () => bookingPage(db, slug))).not.toBeNull();
    });
  });

  it("salon bez datuma prima zakazivanje", async () => {
    await withRollback(async (db) => {
      const { slug } = await openSalon(db);

      expect(await asAnon(db, () => bookingPage(db, slug))).not.toBeNull();
    });
  });

  it("istekao salon ne prima zakazivanje", async () => {
    await withRollback(async (db) => {
      const { tenantId, slug } = await openSalon(db);
      await setPaidUntil(db, tenantId, "2020-01-01");

      expect(await asAnon(db, () => bookingPage(db, slug))).toBeNull();
    });
  });

  it("upis novog datuma vraća salon u rad istog trena", async () => {
    await withRollback(async (db) => {
      const { tenantId, slug } = await openSalon(db);

      await setPaidUntil(db, tenantId, "2020-01-01");
      expect(await asAnon(db, () => bookingPage(db, slug))).toBeNull();

      await setPaidUntil(db, tenantId, "2099-01-01");
      expect(await asAnon(db, () => bookingPage(db, slug))).not.toBeNull();
    });
  });

  it("ni sam upis termina ne prolazi kad je isteklo", async () => {
    await withRollback(async (db) => {
      const { tenantId, slug } = await openSalon(db);
      await setPaidUntil(db, tenantId, "2020-01-01");

      const result = await db.query<{ result: { ok: boolean; reason?: string } }>(
        `select public_book($1, (select id from services where tenant_id = $2 limit 1),
                            now() + interval '3 days', 'Jelena', '+381601234567', 'x')
         as result`,
        [slug, tenantId],
      );

      expect(result.rows[0]!.result).toMatchObject({
        ok: false,
        reason: "booking_closed",
      });
    });
  });
});

describe("šta istek NE gasi", () => {
  it("klijentkinja i dalje može da nađe svoj termin da bi ga otkazala", async () => {
    await withRollback(async (db) => {
      const { tenantId, slug } = await openSalon(db);
      const staffId = (
        await db.query<{ id: string }>(
          "select id from staff where tenant_id = $1 limit 1",
          [tenantId],
        )
      ).rows[0]!.id;
      const serviceId = (
        await db.query<{ id: string }>(
          "select id from services where tenant_id = $1 limit 1",
          [tenantId],
        )
      ).rows[0]!.id;
      const clientId = await createClient(db, tenantId, "+381601112233");

      await insertAppointment(db, {
        tenantId,
        staffId,
        serviceId,
        clientId,
        startAt: "2099-01-05T09:00:00Z",
      });

      await setPaidUntil(db, tenantId, "2020-01-01");

      const summary = await asAnon(db, () =>
        db.query<{ data: unknown | null }>(
          "select public_salon_summary($1) as data",
          [slug],
        ),
      );

      expect(summary.rows[0]!.data).not.toBeNull();
    });
  });
});
