import type pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import {
  asAnon,
  asUser,
  closePool,
  createStaff,
  createTenant,
  createUser,
  inSavepoint,
  withRollback,
} from "./helpers";

afterAll(closePool);

type CreateResult =
  | { ok: true; id: string; slug: string }
  | { ok: false; reason: string };

type WriteResult =
  | { ok: true; suspended?: boolean }
  | { ok: false; reason: string };

let counter = 0;

async function createBareUser(db: pg.PoolClient, email?: string): Promise<string> {
  counter += 1;
  const result = await db.query<{ id: string }>(
    "insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id",
    [email ?? `osoba-${counter}@primer.rs`],
  );
  return result.rows[0]!.id;
}

/** Nalog koji upravlja platformom. */
async function makeAdmin(db: pg.PoolClient): Promise<string> {
  const id = await createBareUser(db, `admin-${(counter += 1)}@zakazi.rs`);
  await db.query("insert into platform_owners (user_id) values ($1)", [id]);
  return id;
}

async function openSalon(
  db: pg.PoolClient,
  input: { name?: string; slug?: string; ownerEmail: string },
): Promise<CreateResult> {
  counter += 1;
  const result = await db.query<{ result: CreateResult }>(
    "select create_tenant($1, $2, $3, 'Europe/Belgrade') as result",
    [
      input.name ?? "Salon Smiley",
      input.slug ?? `salon-smiley-${counter}`,
      input.ownerEmail,
    ],
  );
  return result.rows[0]!.result;
}

describe("salon pravi samo vlasnik platforme", () => {
  it("običan ulogovan korisnik ne može da otvori salon", async () => {
    await withRollback(async (db) => {
      const tenantId = await createTenant(db);
      const userId = await createUser(db, tenantId);
      const email = await db.query<{ email: string }>(
        "select email from auth.users where id = $1",
        [userId],
      );

      const result = await asUser(db, userId, () =>
        openSalon(db, { ownerEmail: email.rows[0]!.email }),
      );

      expect(result).toEqual({ ok: false, reason: "not_allowed" });
    });
  });

  it("neulogovan posetilac ne sme ni da je pozove", async () => {
    await withRollback(async (db) => {
      await asAnon(db, async () => {
        await expect(
          inSavepoint(db, () => openSalon(db, { ownerEmail: "bilo@ko.rs" })),
        ).rejects.toThrow(/permission denied/i);
      });
    });
  });

  it("vlasnica dobija članstvo i mesto izvođača, admin samo članstvo", async () => {
    await withRollback(async (db) => {
      const admin = await makeAdmin(db);
      const her = await createBareUser(db, "gaga@primer.rs");

      const created = await asUser(db, admin, () =>
        openSalon(db, { name: "Salon Smiley", ownerEmail: "gaga@primer.rs" }),
      );

      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const members = await db.query<{ user_id: string }>(
        "select user_id from memberships where tenant_id = $1 order by user_id",
        [created.id],
      );
      expect(members.rows.map((row) => row.user_id).sort()).toEqual(
        [admin, her].sort(),
      );

      // Izvođač je ona, ne on. Inače bi klijentkinje zakazivale kod admina.
      const staff = await db.query<{ user_id: string; name: string }>(
        "select user_id, name from staff where tenant_id = $1",
        [created.id],
      );
      expect(staff.rows).toEqual([{ user_id: her, name: "Salon Smiley" }]);
    });
  });

  it("nepoznat mejl vlasnice se odbija", async () => {
    await withRollback(async (db) => {
      const admin = await makeAdmin(db);

      const result = await asUser(db, admin, () =>
        openSalon(db, { ownerEmail: "niko@primer.rs" }),
      );

      expect(result).toEqual({ ok: false, reason: "no_such_user" });
    });
  });

  it("mejl se poredi bez obzira na veličinu slova", async () => {
    await withRollback(async (db) => {
      const admin = await makeAdmin(db);
      await createBareUser(db, "gaga@primer.rs");

      const result = await asUser(db, admin, () =>
        openSalon(db, { ownerEmail: "  GAGA@Primer.RS  " }),
      );

      expect(result.ok).toBe(true);
    });
  });

  it("loše ime, adresa i tajmzona se odbijaju", async () => {
    await withRollback(async (db) => {
      const admin = await makeAdmin(db);
      await createBareUser(db, "gaga@primer.rs");

      await asUser(db, admin, async () => {
        expect(
          await openSalon(db, { name: "  ", ownerEmail: "gaga@primer.rs" }),
        ).toEqual({ ok: false, reason: "invalid_name" });

        expect(
          await openSalon(db, { slug: "Salon Smiley", ownerEmail: "gaga@primer.rs" }),
        ).toEqual({ ok: false, reason: "invalid_slug" });

        expect(
          await openSalon(db, { slug: "ab", ownerEmail: "gaga@primer.rs" }),
        ).toEqual({ ok: false, reason: "invalid_slug" });

        const badZone = await db.query<{ result: CreateResult }>(
          "select create_tenant('Salon', 'salon-mars', 'gaga@primer.rs', 'Mars/Olympus') as result",
        );
        expect(badZone.rows[0]!.result).toEqual({
          ok: false,
          reason: "invalid_timezone",
        });
      });
    });
  });

  it("zauzeta adresa se odbija umesto da padne na jedinstvenom ključu", async () => {
    await withRollback(async (db) => {
      const admin = await makeAdmin(db);
      await createBareUser(db, "gaga@primer.rs");

      await asUser(db, admin, async () => {
        const first = await openSalon(db, {
          slug: "salon-smiley",
          ownerEmail: "gaga@primer.rs",
        });
        expect(first.ok).toBe(true);

        expect(
          await openSalon(db, {
            slug: "salon-smiley",
            ownerEmail: "gaga@primer.rs",
          }),
        ).toEqual({ ok: false, reason: "slug_taken" });
      });
    });
  });
});

describe("konzola vidi sve salone", () => {
  it("admin dobija spisak sa mejlom vlasnice, običan korisnik prazan", async () => {
    await withRollback(async (db) => {
      const admin = await makeAdmin(db);
      await createBareUser(db, "gaga@primer.rs");

      const created = await asUser(db, admin, () =>
        openSalon(db, { name: "Salon Smiley", ownerEmail: "gaga@primer.rs" }),
      );
      if (!created.ok) throw new Error(created.reason);

      const listed = await asUser(db, admin, async () => {
        const result = await db.query<{
          id: string;
          name: string;
          owner_email: string;
          suspended: boolean;
          services_count: number;
          upcoming_count: number;
        }>("select * from admin_salons()");
        return result.rows;
      });

      expect(listed).toEqual([
        expect.objectContaining({
          id: created.id,
          name: "Salon Smiley",
          // Mejl vlasnice je jedini put do `auth.users`; kroz RLS se ne dolazi.
          owner_email: "gaga@primer.rs",
          suspended: false,
          services_count: 0,
          upcoming_count: 0,
        }),
      ]);

      const tenantId = await createTenant(db);
      const stranger = await createUser(db, tenantId);
      const nothing = await asUser(db, stranger, async () => {
        const result = await db.query("select * from admin_salons()");
        return result.rows;
      });

      expect(nothing).toEqual([]);
    });
  });

  it("salon čija je vlasnica i vlasnik platforme nije „bez vlasnice”", async () => {
    // `create_tenant` upisuje vlasnika platforme kao `owner` člana svakog
    // salona, pa konzola bira člana koji to nije. Kad je vlasnica salona
    // ujedno i vlasnik platforme, drugog člana nema — i pre ove popravke se
    // prikazivalo prazno polje za salon koji vlasnicu uredno ima.
    await withRollback(async (db) => {
      const admin = await makeAdmin(db);
      const adminEmail = await db.query<{ email: string }>(
        "select email from auth.users where id = $1",
        [admin],
      );

      const created = await asUser(db, admin, () =>
        openSalon(db, {
          name: "Salon Šefa",
          ownerEmail: adminEmail.rows[0]!.email,
        }),
      );
      if (!created.ok) throw new Error(created.reason);

      const listed = await asUser(db, admin, async () => {
        const result = await db.query<{ id: string; owner_email: string }>(
          "select id, owner_email from admin_salons()",
        );
        return result.rows;
      });

      expect(listed).toEqual([
        { id: created.id, owner_email: adminEmail.rows[0]!.email },
      ]);
    });
  });

  it("vlasnica salona ne vidi ni svoj salon u konzoli", async () => {
    await withRollback(async (db) => {
      const admin = await makeAdmin(db);
      const her = await createBareUser(db, "gaga@primer.rs");
      await asUser(db, admin, () =>
        openSalon(db, { ownerEmail: "gaga@primer.rs" }),
      );

      const seen = await asUser(db, her, async () => {
        const result = await db.query("select * from admin_salons()");
        return result.rows;
      });

      expect(seen).toEqual([]);
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

describe("prekidač salona", () => {
  async function suspend(
    db: pg.PoolClient,
    tenantId: string,
    suspended: boolean,
  ): Promise<WriteResult> {
    const result = await db.query<{ result: WriteResult }>(
      "select set_tenant_suspended($1, $2) as result",
      [tenantId, suspended],
    );
    return result.rows[0]!.result;
  }

  /** Salon koji stvarno prima zakazivanje, da suspenzija ima šta da ugasi. */
  async function bookableSalon(db: pg.PoolClient) {
    const tenantId = await createTenant(db);
    const staffId = await createStaff(db, tenantId);
    const result = await db.query<{ id: string }>(
      `insert into services (tenant_id, name, duration_min, price_rsd)
       values ($1, 'Gel nokti', 90, 2500) returning id`,
      [tenantId],
    );
    await db.query(
      "insert into staff_services (tenant_id, staff_id, service_id) values ($1, $2, $3)",
      [tenantId, staffId, result.rows[0]!.id],
    );
    const slug = await db.query<{ slug: string }>(
      "select slug from tenants where id = $1",
      [tenantId],
    );
    return { tenantId, slug: slug.rows[0]!.slug };
  }

  it("samo admin gasi salon", async () => {
    await withRollback(async (db) => {
      const tenantId = await createTenant(db);
      const her = await createUser(db, tenantId);

      expect(await asUser(db, her, () => suspend(db, tenantId, true))).toEqual({
        ok: false,
        reason: "not_allowed",
      });

      const admin = await makeAdmin(db);
      expect(await asUser(db, admin, () => suspend(db, tenantId, true))).toEqual({
        ok: true,
        suspended: true,
      });
    });
  });

  it("ugašen salon nestaje sa javne stranice", async () => {
    await withRollback(async (db) => {
      const { tenantId, slug } = await bookableSalon(db);
      const admin = await makeAdmin(db);

      const before = await db.query<{ data: unknown }>(
        "select public_booking_data($1) as data",
        [slug],
      );
      expect(before.rows[0]!.data).not.toBeNull();

      await asUser(db, admin, () => suspend(db, tenantId, true));

      const after = await db.query<{ data: unknown }>(
        "select public_booking_data($1) as data",
        [slug],
      );
      // Ne razlikuje se od nepostojećeg salona: klijentkinja nema šta da
      // sazna o tuđim računima.
      expect(after.rows[0]!.data).toBeNull();
    });
  });

  it("ugašen salon odbija i direktan poziv za zakazivanje", async () => {
    await withRollback(async (db) => {
      const { tenantId, slug } = await bookableSalon(db);
      const admin = await makeAdmin(db);
      await asUser(db, admin, () => suspend(db, tenantId, true));

      const serviceId = await db.query<{ id: string }>(
        "select id from services where tenant_id = $1",
        [tenantId],
      );

      const result = await db.query<{ result: WriteResult }>(
        `select public_book($1, $2, '2027-03-01T09:00:00Z', 'Jelena',
                            '+381641234567', null) as result`,
        [slug, serviceId.rows[0]!.id],
      );

      expect(result.rows[0]!.result).toEqual({
        ok: false,
        reason: "booking_closed",
      });
    });
  });

  it("vlasnici se kaže da je pauzirano, kalendar joj ostaje", async () => {
    await withRollback(async (db) => {
      const { tenantId } = await bookableSalon(db);
      const her = await createUser(db, tenantId);
      const admin = await makeAdmin(db);
      await asUser(db, admin, () => suspend(db, tenantId, true));

      const week = await asUser(db, her, async () => {
        const result = await db.query<{
          tenant: { suspended: boolean; name: string };
        }>("select dashboard_week(null, $1)->'tenant' as tenant", [tenantId]);
        return result.rows[0]!.tenant;
      });

      expect(week.suspended).toBe(true);
      expect(week.name).toBeTruthy();
    });
  });

  it("vlasnica ne može sebi da skine suspenziju", async () => {
    await withRollback(async (db) => {
      const tenantId = await createTenant(db);
      const her = await createUser(db, tenantId);
      const admin = await makeAdmin(db);
      await asUser(db, admin, () => suspend(db, tenantId, true));

      await asUser(db, her, async () => {
        await expect(
          inSavepoint(db, () =>
            db.query("update tenants set suspended_at = null where id = $1", [
              tenantId,
            ]),
          ),
        ).rejects.toThrow(/permission denied/i);
      });

      const still = await db.query<{ suspended: boolean }>(
        "select suspended_at is not null as suspended from tenants where id = $1",
        [tenantId],
      );
      expect(still.rows[0]!.suspended).toBe(true);
    });
  });

  it("paljenje vraća salon takav kakav je bio", async () => {
    await withRollback(async (db) => {
      const { tenantId, slug } = await bookableSalon(db);
      const admin = await makeAdmin(db);

      await asUser(db, admin, () => suspend(db, tenantId, true));
      expect(await asUser(db, admin, () => suspend(db, tenantId, false))).toEqual({
        ok: true,
        suspended: false,
      });

      const after = await db.query<{ data: unknown }>(
        "select public_booking_data($1) as data",
        [slug],
      );
      expect(after.rows[0]!.data).not.toBeNull();
    });
  });

  it("njeno gašenje zakazivanja preživi suspenziju i vraćanje", async () => {
    await withRollback(async (db) => {
      const { tenantId, slug } = await bookableSalon(db);
      const admin = await makeAdmin(db);

      // Ona je otišla na godišnji i sama ugasila zakazivanje.
      await db.query(
        "update tenants set public_booking_enabled = false where id = $1",
        [tenantId],
      );

      await asUser(db, admin, () => suspend(db, tenantId, true));
      await asUser(db, admin, () => suspend(db, tenantId, false));

      // Skidanje suspenzije ne sme da joj upali ono što je sama isključila.
      const after = await db.query<{ data: unknown }>(
        "select public_booking_data($1) as data",
        [slug],
      );
      expect(after.rows[0]!.data).toBeNull();
    });
  });
});
