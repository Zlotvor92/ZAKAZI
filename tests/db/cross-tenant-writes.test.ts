import { afterAll, describe, expect, it } from "vitest";
import {
  asAnon,
  asUser,
  closePool,
  createPopulatedTenant,
  inSavepoint,
  withRollback,
} from "./helpers";

/**
 * AUDIT — pokušaji da se tenant A dohvati tenant B direktno kroz tabele, bez
 * aplikacionog koda. Sve ovo su potvrde ispravnog ponašanja (prolaze).
 */

afterAll(closePool);

async function twoTenants(db: import("pg").PoolClient) {
  const a = await createPopulatedTenant(db);
  const b = await createPopulatedTenant(db);
  return { a, b };
}

async function rejected(db: import("pg").PoolClient, sql: string, params: unknown[]) {
  try {
    await inSavepoint(db, () => db.query(sql, params));
    return false;
  } catch {
    return true;
  }
}

describe("A pokušava da upiše tuđe identifikatore", () => {
  it("INSERT termina sa tenant_id salona B odbija RLS", async () => {
    await withRollback(async (db) => {
      const { a, b } = await twoTenants(db);
      await asUser(db, a.userId, async () => {
        expect(
          await rejected(db, `insert into appointments (tenant_id,staff_id,service_id,client_id,start_at,duration_min,price_rsd,source)
            values ($1,$2,$3,$4,now()+interval '9 days',30,0,'salon')`, [b.tenantId, b.staffId, b.serviceId, b.clientId]),
        ).toBe(true);
      });
    });
  });

  it("INSERT termina u svom salonu ali sa staff/service/client iz B odbija složeni strani ključ", async () => {
    await withRollback(async (db) => {
      const { a, b } = await twoTenants(db);
      await asUser(db, a.userId, async () => {
        for (const [staff, service, client] of [
          [b.staffId, a.serviceId, a.clientId],
          [a.staffId, b.serviceId, a.clientId],
          [a.staffId, a.serviceId, b.clientId],
        ]) {
          expect(
            await rejected(db, `insert into appointments (tenant_id,staff_id,service_id,client_id,start_at,duration_min,price_rsd,source)
              values ($1,$2,$3,$4,now()+interval '9 days',30,0,'salon')`, [a.tenantId, staff, service, client]),
          ).toBe(true);
        }
      });
    });
  });

  it("UPDATE sopstvenog termina na tuđi tenant_id / staff_id / client_id pada", async () => {
    await withRollback(async (db) => {
      const { a, b } = await twoTenants(db);
      await asUser(db, a.userId, async () => {
        expect(await rejected(db, "update appointments set tenant_id=$2 where id=$1", [a.appointmentId, b.tenantId])).toBe(true);
        expect(await rejected(db, "update appointments set staff_id=$2 where id=$1", [a.appointmentId, b.staffId])).toBe(true);
        expect(await rejected(db, "update appointments set client_id=$2 where id=$1", [a.appointmentId, b.clientId])).toBe(true);
        expect(await rejected(db, "update appointments set service_id=$2 where id=$1", [a.appointmentId, b.serviceId])).toBe(true);
      });
    });
  });

  it("UPDATE tuđeg termina ne pogađa nijedan red; DELETE nije dozvoljen nikome", async () => {
    await withRollback(async (db) => {
      const { a, b } = await twoTenants(db);
      await asUser(db, a.userId, async () => {
        const upd = await db.query("update appointments set price_rsd=1 where id=$1", [b.appointmentId]);
        expect(upd.rowCount).toBe(0);
        await expect(
          inSavepoint(db, () => db.query("delete from appointments where id=$1", [b.appointmentId])),
        ).rejects.toThrow(/permission denied/);
      });
    });
  });

  it("A ne može da se učlani u B (memberships), ni da sebi da role", async () => {
    await withRollback(async (db) => {
      const { a, b } = await twoTenants(db);
      await asUser(db, a.userId, async () => {
        expect(await rejected(db, "insert into memberships (user_id, tenant_id, role) values ($1,$2,'owner')", [a.userId, b.tenantId])).toBe(true);
      });
    });
  });

  it("A ne može da upiše blocklist, error_events ni push pretplatu za tenant B", async () => {
    await withRollback(async (db) => {
      const { a, b } = await twoTenants(db);
      await asUser(db, a.userId, async () => {
        expect(await rejected(db, "insert into blocklist (tenant_id, phone_e164, created_by) values ($1,'+381641112223',$2)", [b.tenantId, a.userId])).toBe(true);
        expect(await rejected(db, "insert into error_events (source,message) values ('client','x')", [])).toBe(true);
        expect(await rejected(db, "insert into push_subscriptions (tenant_id,user_id,endpoint,p256dh,auth) values ($1,$2,'https://fcm.googleapis.com/fcm/send/z','a','b')", [b.tenantId, a.userId])).toBe(true);
      });
    });
  });
});

describe("neulogovan posetilac", () => {
  it("nijedna tabela iz public šeme nije čitljiva, ni broj redova", async () => {
    await withRollback(async (db) => {
      await createPopulatedTenant(db);
      const tables = await db.query<{ tablename: string }>("select tablename from pg_tables where schemaname='public'");
      for (const { tablename } of tables.rows) {
        const denied = await asAnon(db, async () => rejected(db, `select 1 from public.${tablename} limit 1`, []));
        expect(denied, tablename).toBe(true);
      }
    });
  });

  it("javne funkcije ne vraćaju ni telefon ni ime ni bilo šta o klijentu (samo termini po broju + zauzeto)", async () => {
    await withRollback(async (db) => {
      const { a } = await twoTenants(db);
      const slug = (await db.query<{ slug: string }>("select slug from tenants where id=$1", [a.tenantId])).rows[0]!.slug;
      const data = await asAnon(db, async () =>
        (await db.query<{ d: unknown }>("select public_booking_data($1) as d", [slug])).rows[0]!.d);
      const text = JSON.stringify(data);
      expect(text).not.toMatch(/\+381/);
      expect(text).not.toContain("Jelena");
      expect(text).not.toContain("client");
    });
  });
});
