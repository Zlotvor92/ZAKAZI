import type pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import {
  asAnon,
  asUser,
  closePool,
  createTenant,
  createUser,
  inSavepoint,
  withRollback,
} from "./helpers";

afterAll(closePool);

type WriteResult = { ok: true } | { ok: false; reason: string };

let counter = 0;

async function createBareUser(db: pg.PoolClient): Promise<string> {
  counter += 1;
  const result = await db.query<{ id: string }>(
    "insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id",
    [`osoba-paid-${counter}@primer.rs`],
  );
  return result.rows[0]!.id;
}

async function makeAdmin(db: pg.PoolClient): Promise<string> {
  const id = await createBareUser(db);
  await db.query("insert into platform_owners (user_id) values ($1)", [id]);
  return id;
}

async function setPaidUntil(
  db: pg.PoolClient,
  tenantId: string,
  paidUntil: string | null,
): Promise<WriteResult> {
  const result = await db.query<{ result: WriteResult }>(
    "select set_tenant_paid_until($1, $2) as result",
    [tenantId, paidUntil],
  );
  return result.rows[0]!.result;
}

async function paidUntilOf(
  db: pg.PoolClient,
  tenantId: string,
): Promise<string | null> {
  const result = await db.query<{ paid_until: string | null }>(
    "select to_char(paid_until, 'YYYY-MM-DD') as paid_until from tenants where id = $1",
    [tenantId],
  );
  return result.rows[0]!.paid_until;
}

describe("datum do kog je plaćeno", () => {
  it("vlasnik platforme upisuje i briše datum", async () => {
    await withRollback(async (db) => {
      const admin = await makeAdmin(db);
      const tenantId = await createTenant(db);

      const saved = await asUser(db, admin, () =>
        setPaidUntil(db, tenantId, "2026-12-31"),
      );
      expect(saved).toEqual({ ok: true });
      expect(await paidUntilOf(db, tenantId)).toBe("2026-12-31");

      const cleared = await asUser(db, admin, () =>
        setPaidUntil(db, tenantId, null),
      );
      expect(cleared).toEqual({ ok: true });
      expect(await paidUntilOf(db, tenantId)).toBeNull();
    });
  });

  it("novi salon nema datum, pa mu se ne naplaćuje", async () => {
    await withRollback(async (db) => {
      const tenantId = await createTenant(db);

      expect(await paidUntilOf(db, tenantId)).toBeNull();
    });
  });

  it("vlasnica salona ne može da pomeri svoj datum", async () => {
    // Inače bi svaka vlasnica sebi produžila pretplatu.
    await withRollback(async (db) => {
      const tenantId = await createTenant(db);
      const her = await createUser(db, tenantId);

      const result = await asUser(db, her, () =>
        setPaidUntil(db, tenantId, "2030-01-01"),
      );

      expect(result).toEqual({ ok: false, reason: "not_allowed" });
      expect(await paidUntilOf(db, tenantId)).toBeNull();
    });
  });

  it("neulogovan posetilac ne sme ni da je pozove", async () => {
    await withRollback(async (db) => {
      const tenantId = await createTenant(db);

      await asAnon(db, async () => {
        await expect(
          inSavepoint(db, () => setPaidUntil(db, tenantId, "2030-01-01")),
        ).rejects.toThrow(/permission denied/i);
      });
    });
  });

  it("konzola izdiže isteklo na vrh, a salone bez datuma spušta na dno", async () => {
    await withRollback(async (db) => {
      const admin = await makeAdmin(db);
      const bezDatuma = await createTenant(db);
      const istekao = await createTenant(db);
      const vazi = await createTenant(db);

      await asUser(db, admin, async () => {
        await setPaidUntil(db, istekao, "2020-01-01");
        await setPaidUntil(db, vazi, "2099-01-01");
      });

      const order = await asUser(db, admin, async () => {
        const result = await db.query<{ id: string }>(
          "select id from admin_salons()",
        );
        return result.rows.map((row) => row.id);
      });

      expect(order.indexOf(istekao)).toBeLessThan(order.indexOf(vazi));
      expect(order.indexOf(vazi)).toBeLessThan(order.indexOf(bezDatuma));
    });
  });

  it("vlasnica vidi svoj datum u kalendaru", async () => {
    await withRollback(async (db) => {
      const admin = await makeAdmin(db);
      const tenantId = await createTenant(db);
      const her = await createUser(db, tenantId);

      await asUser(db, admin, () => setPaidUntil(db, tenantId, "2026-11-30"));

      const week = await asUser(db, her, async () => {
        const result = await db.query<{
          data: { tenant: { paid_until: string | null } };
        }>("select dashboard_week(null, $1) as data", [tenantId]);
        return result.rows[0]!.data;
      });

      expect(week.tenant.paid_until).toBe("2026-11-30");
    });
  });
});
