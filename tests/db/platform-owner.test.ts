import type pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import {
  asUser,
  closePool,
  createService,
  createStaff,
  createTenant,
  createUser,
  withRollback,
} from "./helpers";

afterAll(closePool);

type CreateResult =
  | { ok: true; id: string; slug: string }
  | { ok: false; reason: string };

async function createTenantRpc(
  db: pg.PoolClient,
  name: string,
  slug: string,
): Promise<CreateResult> {
  const result = await db.query<{ result: CreateResult }>(
    "select create_tenant($1, $2, 'Europe/Belgrade') as result",
    [name, slug],
  );
  return result.rows[0]!.result;
}

async function createBareUser(db: pg.PoolClient, email: string): Promise<string> {
  const result = await db.query<{ id: string }>(
    "insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id",
    [email],
  );
  return result.rows[0]!.id;
}

async function visibleTenants(
  db: pg.PoolClient,
  userId: string,
): Promise<string[]> {
  return asUser(db, userId, async () => {
    const result = await db.query<{ id: string }>("select id from my_tenants()");
    return result.rows.map((row) => row.id);
  });
}

describe("salon vidi samo svoja vrata", () => {
  it("vlasnica jednog salona ne vidi ni ime drugog", async () => {
    await withRollback(async (db) => {
      const hers = await createTenant(db);
      const theirs = await createTenant(db);
      const her = await createUser(db, hers);
      await createUser(db, theirs);

      expect(await visibleTenants(db, her)).toEqual([hers]);
    });
  });

  it("ne vidi ni termine, ni klijente, ni usluge tuđeg salona", async () => {
    await withRollback(async (db) => {
      const hers = await createTenant(db);
      const theirs = await createTenant(db);
      const her = await createUser(db, hers);

      await createStaff(db, theirs, "Tuđa");
      await createService(db, theirs);

      const seen = await asUser(db, her, async () => {
        const result = await db.query<{
          services: string;
          staff: string;
          clients: string;
          appointments: string;
        }>(`select
              (select count(*) from services where tenant_id = $1)::text as services,
              (select count(*) from staff where tenant_id = $1)::text as staff,
              (select count(*) from clients where tenant_id = $1)::text as clients,
              (select count(*) from appointments where tenant_id = $1)::text as appointments`,
          [theirs],
        );
        return result.rows[0]!;
      });

      expect(seen).toEqual({
        services: "0",
        staff: "0",
        clients: "0",
        appointments: "0",
      });
    });
  });
});

describe("vlasnik platforme", () => {
  it("ulazi u salon koji je neko drugi upravo otvorio", async () => {
    await withRollback(async (db) => {
      const admin = await createBareUser(db, "admin@zakazi.rs");
      await db.query("insert into platform_owners (user_id) values ($1)", [
        admin,
      ]);

      const her = await createBareUser(db, "gaga@primer.rs");
      const created = await asUser(db, her, () =>
        createTenantRpc(db, "Salon Smiley", "salon-smiley"),
      );

      expect(created.ok).toBe(true);
      if (!created.ok) return;

      expect(await visibleTenants(db, admin)).toEqual([created.id]);
      expect(await visibleTenants(db, her)).toEqual([created.id]);
    });
  });

  it("ne postaje izvođač u tuđem salonu — kontrola nije rad", async () => {
    await withRollback(async (db) => {
      const admin = await createBareUser(db, "admin@zakazi.rs");
      await db.query("insert into platform_owners (user_id) values ($1)", [
        admin,
      ]);

      const her = await createBareUser(db, "gaga@primer.rs");
      const created = await asUser(db, her, () =>
        createTenantRpc(db, "Salon Smiley", "salon-smiley"),
      );
      if (!created.ok) throw new Error(created.reason);

      const staff = await db.query<{ user_id: string; name: string }>(
        "select user_id, name from staff where tenant_id = $1",
        [created.id],
      );

      expect(staff.rows).toEqual([{ user_id: her, name: "Salon Smiley" }]);
    });
  });

  it("salon otvoren pre nego što je admin postavljen ostaje njegov posao", async () => {
    await withRollback(async (db) => {
      const her = await createBareUser(db, "gaga@primer.rs");
      const created = await asUser(db, her, () =>
        createTenantRpc(db, "Salon Smiley", "salon-smiley"),
      );
      if (!created.ok) throw new Error(created.reason);

      const admin = await createBareUser(db, "admin@zakazi.rs");
      await db.query("insert into platform_owners (user_id) values ($1)", [
        admin,
      ]);

      // Postojeći saloni se ne dodaju unazad; to je svesno, jer bi značilo da
      // upis u jednu tabelu tiho otvara pristup svemu što već postoji.
      expect(await visibleTenants(db, admin)).toEqual([]);
    });
  });

  it("spisak vlasnika platforme ne čita ni ulogovan korisnik", async () => {
    await withRollback(async (db) => {
      const tenantId = await createTenant(db);
      const userId = await createUser(db, tenantId);

      const rows = await asUser(db, userId, async () => {
        const result = await db.query("select * from platform_owners");
        return result.rows;
      });

      expect(rows).toEqual([]);
    });
  });
});

describe("boje salona", () => {
  it("javna stranica nosi boje tog salona", async () => {
    await withRollback(async (db) => {
      const tenantId = await createTenant(db);
      const staffId = await createStaff(db, tenantId);
      const serviceId = await createService(db, tenantId);
      await db.query(
        "insert into staff_services (tenant_id, staff_id, service_id) values ($1, $2, $3)",
        [tenantId, staffId, serviceId],
      );
      await db.query(
        `update tenants set brand_background = '#0a0a0a',
                            brand_primary = '#e11d2e',
                            brand_accent = '#f5c518'
         where id = $1`,
        [tenantId],
      );

      const slug = await db.query<{ slug: string }>(
        "select slug from tenants where id = $1",
        [tenantId],
      );
      const data = await db.query<{ tenant: Record<string, string> }>(
        "select public_booking_data($1)->'tenant' as tenant",
        [slug.rows[0]!.slug],
      );

      expect(data.rows[0]!.tenant).toMatchObject({
        brand_background: "#0a0a0a",
        brand_primary: "#e11d2e",
        brand_accent: "#f5c518",
      });
    });
  });

  it("salon bez boja i dalje radi", async () => {
    await withRollback(async (db) => {
      const tenantId = await createTenant(db);
      const staffId = await createStaff(db, tenantId);
      const serviceId = await createService(db, tenantId);
      await db.query(
        "insert into staff_services (tenant_id, staff_id, service_id) values ($1, $2, $3)",
        [tenantId, staffId, serviceId],
      );

      const slug = await db.query<{ slug: string }>(
        "select slug from tenants where id = $1",
        [tenantId],
      );
      const data = await db.query<{ tenant: Record<string, string | null> }>(
        "select public_booking_data($1)->'tenant' as tenant",
        [slug.rows[0]!.slug],
      );

      expect(data.rows[0]!.tenant).toMatchObject({
        brand_background: null,
        brand_primary: null,
        brand_accent: null,
      });
    });
  });

  it("boja koja nije heks se ne upisuje", async () => {
    await withRollback(async (db) => {
      const tenantId = await createTenant(db);

      await expect(
        db.query("update tenants set brand_primary = 'crvena' where id = $1", [
          tenantId,
        ]),
      ).rejects.toThrow(/tenants_brand_format/);
    });
  });
});
