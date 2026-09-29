import { afterAll, describe, expect, it } from "vitest";
import {
  asUser,
  closePool,
  inSavepoint,
  createPopulatedTenant,
  withRollback,
} from "../../db/helpers";

/** AUDIT — sitniji nalazi. [REPRO] = ispravno ponašanje, trenutno PADA. */

afterAll(closePool);

describe("create_appointment (vlasnica, direktan RPC poziv)", () => {
  it("[REPRO] strani broj vraća {ok:false, reason:'invalid_phone'} umesto da baci check_violation", async () => {
    await withRollback(async (db) => {
      const t = await createPopulatedTenant(db);
      const result = await asUser(db, t.userId, async () => {
        try {
          const r = await inSavepoint(db, () =>
            db.query<{ r: { ok: boolean; reason?: string } }>(
              `select create_appointment($1, now() + interval '30 days', 30, 'Hans', '+4917612345678', null) as r`,
              [t.serviceId],
            ),
          );
          return r.rows[0]!.r;
        } catch (error) {
          return { ok: false, reason: `EXCEPTION: ${(error as Error).message}` };
        }
      });
      expect(result).toMatchObject({ ok: false, reason: "invalid_phone" });
    });
  });
});

describe("public_book prima nekanonski početak", () => {
  it("[REPRO] početak sa razlomkom sekunde (09:00:00.4) se ne prihvata, a susedni termin ostaje slobodan", async () => {
    await withRollback(async (db) => {
      const tenantId = (await db.query<{ id: string }>(
        "insert into tenants (slug,name,min_lead_minutes,booking_horizon_days) values ('frac-audit','F',0,60) returning id")).rows[0]!.id;
      const staffId = (await db.query<{ id: string }>("insert into staff (tenant_id,name) values ($1,'M') returning id",[tenantId])).rows[0]!.id;
      const serviceId = (await db.query<{ id: string }>("insert into services (tenant_id,name,duration_min,price_rsd) values ($1,'S',60,1000) returning id",[tenantId])).rows[0]!.id;
      await db.query("insert into staff_services (tenant_id,staff_id,service_id) values ($1,$2,$3)",[tenantId,staffId,serviceId]);
      for (const d of [1,2,3,4,5,6,7]) {
        await db.query("insert into working_hours (tenant_id,staff_id,weekday,start_time,end_time,slot_minutes) values ($1,$2,$3,'09:00','18:00',60)",[tenantId,staffId,d]);
      }
      const day = (await db.query<{ d: string }>("select ((now() at time zone 'Europe/Belgrade')::date + 10)::text as d")).rows[0]!.d;
      const skewed = await db.query<{ r: { ok: boolean; reason?: string } }>(
        `select public_book('frac-audit',$1,(($2::date + time '09:00') at time zone 'Europe/Belgrade') + interval '0.4 seconds','Test','+381644173829',null,'h1') as r`,
        [serviceId, day]);
      const neighbour = await db.query<{ r: { ok: boolean; reason?: string } }>(
        `select public_book('frac-audit',$1,(($2::date + time '10:00') at time zone 'Europe/Belgrade'),'Test2','+381644173830',null,'h2') as r`,
        [serviceId, day]);

      expect({
        skewedAccepted: skewed.rows[0]!.r.ok,
        neighbourAccepted: neighbour.rows[0]!.r.ok,
        neighbourReason: neighbour.rows[0]!.r.reason,
      }).toEqual({ skewedAccepted: false, neighbourAccepted: true, neighbourReason: undefined });
    });
  });
});

describe("push_subscriptions.endpoint", () => {
  it("[REPRO] vlasnica ne sme direktnim upisom da podmetne endpoint koji nije servis za push (server ga kasnije gađa web-push-om)", async () => {
    await withRollback(async (db) => {
      const t = await createPopulatedTenant(db);
      const accepted = await asUser(db, t.userId, async () => {
        try {
          await inSavepoint(db, () =>
            db.query(
              `insert into push_subscriptions (tenant_id, user_id, endpoint, p256dh, auth)
               values ($1, $2, 'https://attacker.example.test/collect', 'k', 'a')`,
              [t.tenantId, t.userId],
            ),
          );
          return true;
        } catch {
          return false;
        }
      });
      expect(accepted).toBe(false);
    });
  });
});
