import type pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import {
  asAnon,
  asUser,
  closePool,
  createPopulatedTenant,
  createTenant,
  createUser,
  inSavepoint,
  withRollback,
} from "./helpers";

afterAll(closePool);

type DeleteResult =
  | { ok: true; name: string }
  | { ok: false; reason: string };

/** Svaka tabela sa podacima korisnika koju salon za sobom vuče. */
const TENANT_TABLES = [
  "memberships",
  "staff",
  "services",
  "clients",
  "staff_services",
  "working_hours",
  "time_off",
  "blocklist",
  "push_subscriptions",
  "messages",
  "appointments",
] as const;

let counter = 0;

async function makeAdmin(db: pg.PoolClient): Promise<string> {
  counter += 1;
  const result = await db.query<{ id: string }>(
    "insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id",
    [`admin-${counter}@zakazi.rs`],
  );
  const id = result.rows[0]!.id;
  await db.query("insert into platform_owners (user_id) values ($1)", [id]);
  return id;
}

async function removeSalon(
  db: pg.PoolClient,
  tenantId: string,
  slug: string,
): Promise<DeleteResult> {
  const result = await db.query<{ result: DeleteResult }>(
    "select delete_tenant($1, $2) as result",
    [tenantId, slug],
  );
  return result.rows[0]!.result;
}

async function slugOf(db: pg.PoolClient, tenantId: string): Promise<string> {
  const result = await db.query<{ slug: string }>(
    "select slug from tenants where id = $1",
    [tenantId],
  );
  return result.rows[0]!.slug;
}

async function tenantExists(
  db: pg.PoolClient,
  tenantId: string,
): Promise<boolean> {
  const result = await db.query(
    "select 1 from tenants where id = $1",
    [tenantId],
  );
  return result.rowCount === 1;
}

describe("salon briše samo vlasnik platforme", () => {
  it("vlasnica salona ne može da obriše svoj salon", async () => {
    await withRollback(async (db) => {
      const tenantId = await createTenant(db);
      const userId = await createUser(db, tenantId);
      const slug = await slugOf(db, tenantId);

      const result = await asUser(db, userId, () =>
        removeSalon(db, tenantId, slug),
      );

      expect(result).toEqual({ ok: false, reason: "not_allowed" });
      expect(await tenantExists(db, tenantId)).toBe(true);
    });
  });

  it("vlasnica jednog salona ne može da obriše tuđi", async () => {
    await withRollback(async (db) => {
      const mine = await createTenant(db);
      const theirs = await createTenant(db);
      const userId = await createUser(db, mine);
      const slug = await slugOf(db, theirs);

      const result = await asUser(db, userId, () =>
        removeSalon(db, theirs, slug),
      );

      expect(result).toEqual({ ok: false, reason: "not_allowed" });
      expect(await tenantExists(db, theirs)).toBe(true);
    });
  });

  it("neprijavljen posetilac ne može ni da pozove funkciju", async () => {
    await withRollback(async (db) => {
      const tenantId = await createTenant(db);
      const slug = await slugOf(db, tenantId);

      await expect(
        inSavepoint(db, () =>
          asAnon(db, () => removeSalon(db, tenantId, slug)),
        ),
      ).rejects.toThrow();

      expect(await tenantExists(db, tenantId)).toBe(true);
    });
  });
});

describe("prekucana adresa je uslov, ne ukras", () => {
  it("pogrešna adresa ne briše ništa", async () => {
    await withRollback(async (db) => {
      const tenantId = await createTenant(db);
      const adminId = await makeAdmin(db);

      const result = await asUser(db, adminId, () =>
        removeSalon(db, tenantId, "neki-drugi-salon"),
      );

      expect(result).toEqual({ ok: false, reason: "slug_mismatch" });
      expect(await tenantExists(db, tenantId)).toBe(true);
    });
  });

  it("prazna potvrda ne briše ništa", async () => {
    await withRollback(async (db) => {
      const tenantId = await createTenant(db);
      const adminId = await makeAdmin(db);

      const result = await asUser(db, adminId, () =>
        removeSalon(db, tenantId, ""),
      );

      expect(result).toEqual({ ok: false, reason: "slug_mismatch" });
      expect(await tenantExists(db, tenantId)).toBe(true);
    });
  });

  it("salon koji ne postoji javlja not_found", async () => {
    await withRollback(async (db) => {
      const adminId = await makeAdmin(db);

      const result = await asUser(db, adminId, () =>
        removeSalon(db, "00000000-0000-0000-0000-000000000000", "bilo-sta"),
      );

      expect(result).toEqual({ ok: false, reason: "not_found" });
    });
  });
});

describe("brisanje odnosi i sve što visi o salonu", () => {
  it("tačna adresa briše salon", async () => {
    await withRollback(async (db) => {
      const tenantId = await createTenant(db);
      const adminId = await makeAdmin(db);
      const slug = await slugOf(db, tenantId);

      const result = await asUser(db, adminId, () =>
        removeSalon(db, tenantId, slug),
      );

      expect(result).toMatchObject({ ok: true });
      expect(await tenantExists(db, tenantId)).toBe(false);
    });
  });

  it("nijedna tabela ne zadržava red obrisanog salona", async () => {
    await withRollback(async (db) => {
      const { tenantId, appointmentId } = await createPopulatedTenant(db);
      const adminId = await makeAdmin(db);
      const slug = await slugOf(db, tenantId);

      const result = await asUser(db, adminId, () =>
        removeSalon(db, tenantId, slug),
      );
      expect(result).toMatchObject({ ok: true });

      for (const table of TENANT_TABLES) {
        const left = await db.query(
          `select 1 from ${table} where tenant_id = $1`,
          [tenantId],
        );
        expect({ table, rows: left.rowCount }).toEqual({ table, rows: 0 });
      }

      // `appointment_events` se vezuje za termin, ne za salon — red koji
      // triger upiše mora otići istim putem.
      const events = await db.query(
        "select 1 from appointment_events where appointment_id = $1",
        [appointmentId],
      );
      expect(events.rowCount).toBe(0);
    });
  });
});
