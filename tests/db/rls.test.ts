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

const TENANT_SCOPED_TABLES = [
  "memberships",
  "staff",
  "services",
  "staff_services",
  "working_hours",
  "time_off",
  "clients",
  "appointments",
  "appointment_events",
  "blocklist",
  "push_subscriptions",
  "messages",
] as const;

async function countIn(
  db: Parameters<typeof asUser>[0],
  table: string,
  tenantId: string,
): Promise<number> {
  const result = await db.query<{ count: string }>(
    `select count(*)::text as count from ${table} where tenant_id = $1`,
    [tenantId],
  );
  return Number(result.rows[0]!.count);
}

describe("pokrivenost", () => {
  it("svaka tabela u public šemi ima uključen RLS i bar jednu politiku", async () => {
    await withRollback(async (db) => {
      const result = await db.query<{
        table_name: string;
        rls_enabled: boolean;
        policies: string;
      }>(
        `select c.relname as table_name,
                c.relrowsecurity as rls_enabled,
                count(p.polname)::text as policies
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         left join pg_policy p on p.polrelid = c.oid
         where n.nspname = 'public' and c.relkind = 'r'
         group by c.relname, c.relrowsecurity
         order by c.relname`,
      );

      // Broj je namerno zakucan: nova tabela obara ovaj test i tera da se
      // politika napiše sada, a ne kad se primeti da nešto curi.
      expect(result.rows.length).toBe(14);

      // `platform_owners` je jedina tabela bez ijedne politike, i to je
      // najstroža moguća postavka: uz uključen RLS bez politike joj kroz API
      // ne pristupa niko. Ako joj neko doda politiku, ovaj test to prijavi.
      const closed = "platform_owners";

      for (const row of result.rows) {
        expect(
          { table: row.table_name, rls: row.rls_enabled },
          `${row.table_name} nema uključen RLS`,
        ).toEqual({ table: row.table_name, rls: true });

        if (row.table_name === closed) {
          expect(
            Number(row.policies),
            `${closed} više nije zatvorena za sve`,
          ).toBe(0);
          continue;
        }

        expect(
          Number(row.policies),
          `${row.table_name} nema nijednu politiku`,
        ).toBeGreaterThan(0);
      }
    });
  });
});

describe("izolacija između tenanta", () => {
  it("vlasnik salona A ne vidi nijedan red salona B", async () => {
    await withRollback(async (db) => {
      const a = await createPopulatedTenant(db);
      const b = await createPopulatedTenant(db);

      await asUser(db, a.userId, async () => {
        for (const table of TENANT_SCOPED_TABLES) {
          expect(
            { table, count: await countIn(db, table, b.tenantId) },
            `${table} propušta redove drugog tenanta`,
          ).toEqual({ table, count: 0 });
        }
      });
    });
  });

  it("vlasnik salona A vidi sve svoje redove", async () => {
    await withRollback(async (db) => {
      const a = await createPopulatedTenant(db);
      await createPopulatedTenant(db);

      await asUser(db, a.userId, async () => {
        for (const table of TENANT_SCOPED_TABLES) {
          expect(
            { table, count: await countIn(db, table, a.tenantId) },
            `${table} krije sopstvene redove`,
          ).toEqual({ table, count: 1 });
        }
      });
    });
  });

  it("vidi svoj salon u tabeli tenants, tuđi ne", async () => {
    await withRollback(async (db) => {
      const a = await createPopulatedTenant(db);
      const b = await createPopulatedTenant(db);

      await asUser(db, a.userId, async () => {
        const visible = await db.query<{ id: string }>(
          "select id from tenants where id in ($1, $2)",
          [a.tenantId, b.tenantId],
        );
        expect(visible.rows.map((row) => row.id)).toEqual([a.tenantId]);
      });
    });
  });

  it("korisnik bez ijednog članstva ne vidi ništa", async () => {
    await withRollback(async (db) => {
      const a = await createPopulatedTenant(db);
      const orphanTenant = await createTenant(db);
      const orphanUser = await createUser(db, orphanTenant);
      await db.query("delete from memberships where user_id = $1", [orphanUser]);

      await asUser(db, orphanUser, async () => {
        for (const table of TENANT_SCOPED_TABLES) {
          expect(
            { table, count: await countIn(db, table, a.tenantId) },
            `${table} je vidljiv korisniku bez članstva`,
          ).toEqual({ table, count: 0 });
        }
      });
    });
  });

  it("neulogovan posetilac ne vidi ništa", async () => {
    await withRollback(async (db) => {
      const a = await createPopulatedTenant(db);

      await asAnon(db, async () => {
        for (const table of TENANT_SCOPED_TABLES) {
          expect(
            { table, count: await countIn(db, table, a.tenantId) },
            `${table} je vidljiv neulogovanom posetiocu`,
          ).toEqual({ table, count: 0 });
        }
      });
    });
  });
});

describe("upis preko granice tenanta", () => {
  it("odbija upis klijenta sa tuđim tenant_id", async () => {
    await withRollback(async (db) => {
      const a = await createPopulatedTenant(db);
      const b = await createPopulatedTenant(db);

      await asUser(db, a.userId, async () => {
        await expect(
          inSavepoint(db, () =>
            db.query(
              "insert into clients (tenant_id, name, phone_e164) values ($1, $2, $3)",
              [b.tenantId, "Podmetnuta", "+381649998887"],
            ),
          ),
        ).rejects.toThrow(/row-level security/i);
      });
    });
  });

  it("izmena tuđeg klijenta ne dira nijedan red", async () => {
    await withRollback(async (db) => {
      const a = await createPopulatedTenant(db);
      const b = await createPopulatedTenant(db);

      const changed = await asUser(db, a.userId, async () => {
        const result = await db.query(
          "update clients set name = 'Preimenovana' where id = $1",
          [b.clientId],
        );
        return result.rowCount;
      });

      expect(changed).toBe(0);

      const untouched = await db.query<{ name: string }>(
        "select name from clients where id = $1",
        [b.clientId],
      );
      expect(untouched.rows[0]!.name).toBe("Jelena");
    });
  });

  it("brisanje tuđeg termina ne dira nijedan red", async () => {
    await withRollback(async (db) => {
      const a = await createPopulatedTenant(db);
      const b = await createPopulatedTenant(db);

      const deleted = await asUser(db, a.userId, async () => {
        const result = await db.query("delete from appointments where id = $1", [
          b.appointmentId,
        ]);
        return result.rowCount;
      });

      expect(deleted).toBe(0);

      const survivors = await db.query<{ count: string }>(
        "select count(*)::text as count from appointments where id = $1",
        [b.appointmentId],
      );
      expect(survivors.rows[0]!.count).toBe("1");
    });
  });

  it("ne može da prebaci sopstveni red u tuđi salon", async () => {
    await withRollback(async (db) => {
      const a = await createPopulatedTenant(db);
      const b = await createPopulatedTenant(db);

      await asUser(db, a.userId, async () => {
        await expect(
          inSavepoint(db, () =>
            db.query("update clients set tenant_id = $1 where id = $2", [
              b.tenantId,
              a.clientId,
            ]),
          ),
        ).rejects.toThrow(/row-level security|violates foreign key/i);
      });
    });
  });
});

describe("appointment_events je samo za dopisivanje", () => {
  it("dozvoljava upis novog reda u sopstvenom salonu", async () => {
    await withRollback(async (db) => {
      const a = await createPopulatedTenant(db);

      const inserted = await asUser(db, a.userId, async () => {
        const result = await db.query(
          `insert into appointment_events
             (tenant_id, appointment_id, from_status, to_status, actor_type, actor_id, device_id)
           values ($1, $2, 'confirmed', 'completed', 'user', $3, 'telefon-1')`,
          [a.tenantId, a.appointmentId, a.userId],
        );
        return result.rowCount;
      });

      expect(inserted).toBe(1);
    });
  });

  it("ne dozvoljava izmenu ni brisanje sopstvenog reda", async () => {
    await withRollback(async (db) => {
      const a = await createPopulatedTenant(db);

      const result = await asUser(db, a.userId, async () => {
        const updated = await db.query(
          "update appointment_events set to_status = 'no_show' where tenant_id = $1",
          [a.tenantId],
        );
        const deleted = await db.query(
          "delete from appointment_events where tenant_id = $1",
          [a.tenantId],
        );
        return { updated: updated.rowCount, deleted: deleted.rowCount };
      });

      expect(result).toEqual({ updated: 0, deleted: 0 });

      const survivors = await db.query<{ to_status: string }>(
        "select to_status from appointment_events where tenant_id = $1",
        [a.tenantId],
      );
      expect(survivors.rows.map((row) => row.to_status)).toEqual(["confirmed"]);
    });
  });
});
