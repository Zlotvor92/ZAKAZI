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
