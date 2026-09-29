import { afterAll, describe, expect, it } from "vitest";
import {
  asAnon,
  asUser,
  closePool,
  createClient,
  createService,
  createStaff,
  createTenant,
  createUser,
  insertAppointment,
  withRollback,
} from "../../db/helpers";

/**
 * AUDIT — zloupotreba javne površine. [REPRO] = ispravno ponašanje, trenutno PADA.
 */

afterAll(closePool);

const MONDAY_SLOTS = 30;

async function salonWithManySlots(db: import("pg").PoolClient) {
  const tenantId = await createTenant(db);
  const staffId = await createStaff(db, tenantId);
  const serviceId = await createService(db, tenantId, 15);
  await db.query(
    "insert into staff_services (tenant_id, staff_id, service_id) values ($1,$2,$3)",
    [tenantId, staffId, serviceId],
  );
  for (const weekday of [1, 2, 3, 4, 5, 6, 7]) {
    await db.query(
      `insert into working_hours (tenant_id, staff_id, weekday, start_time, end_time, slot_minutes)
       values ($1,$2,$3,'09:00','18:00',15)`,
      [tenantId, staffId, weekday],
    );
  }
  await db.query(
    "update tenants set min_lead_minutes = 0, booking_horizon_days = 60 where id = $1",
    [tenantId],
  );
  const slug = (
    await db.query<{ slug: string }>("select slug from tenants where id=$1", [tenantId])
  ).rows[0]!.slug;
  return { tenantId, staffId, serviceId, slug };
}

function mobile(index: number): string {
  return `+38164${String(4173829 + index * 7919).slice(-7)}`;
}

async function instant(db: import("pg").PoolClient, day: number, time: string) {
  return (
    await db.query<{ at: string }>(
      `select to_char((((now() at time zone 'Europe/Belgrade')::date + $1::int) + $2::time)
         at time zone 'Europe/Belgrade','YYYY-MM-DD"T"HH24:MI:SSOF') as at`,
      [day, time],
    )
  ).rows[0]!.at;
}

describe("ograničenje po mreži", () => {
  it("[REPRO] pozivalac koji šalje svaki put drugi p_network_hash zaobilazi limit od 8 po satu", async () => {
    await withRollback(async (db) => {
      const salon = await salonWithManySlots(db);
      // Kong upisuje x-real-ip — to je jedina vrednost koju pozivalac ne bira.
      await db.query("select set_config('request.headers', $1, true)", [
        JSON.stringify({ "x-real-ip": "203.0.113.7" }),
      ]);

      let accepted = 0;
      for (let index = 0; index < MONDAY_SLOTS; index += 1) {
        const startAt = await instant(db, 3 + Math.floor(index / 10), `${9 + (index % 10)}:00`);
        const result = await asAnon(db, async () =>
          (
            await db.query<{ r: { ok: boolean } }>(
              "select public_book($1,$2,$3,'Bot',$4,$5,$6) as r",
              [
                salon.slug,
                salon.serviceId,
                startAt,
                mobile(index),
                `dev-${index}`,
                `rotating-hash-${index}`,
              ],
            )
          ).rows[0]!.r,
        );
        if (result.ok) accepted += 1;
      }

      // Isto što i 8/h po mreži bi trebalo da drži bez obzira šta pozivalac šalje.
      expect(accepted).toBeLessThanOrEqual(8);
    });
  });

  it("kontrola: bez p_network_hash važi x-real-ip i deveti poziv pada", async () => {
    await withRollback(async (db) => {
      // Testna baza nema pgcrypto (Supabase ga nosi u šemi `extensions`), pa se
      // pravi ovde; bez toga putanja preko x-real-ip nije nigde pokrivena.
      await db.query("create schema if not exists extensions");
      await db.query("create extension if not exists pgcrypto with schema extensions");
      const salon = await salonWithManySlots(db);
      await db.query("select set_config('request.headers', $1, true)", [
        JSON.stringify({ "x-real-ip": "203.0.113.8" }),
      ]);

      const reasons: (string | undefined)[] = [];
      for (let index = 0; index < 10; index += 1) {
        const startAt = await instant(db, 3, `${9 + index}:00`);
        const result = await asAnon(db, async () =>
          (
            await db.query<{ r: { ok: boolean; reason?: string } }>(
              "select public_book($1,$2,$3,'Bot',$4,null,null) as r",
              [salon.slug, salon.serviceId, startAt, mobile(index)],
            ).catch((error: Error) => { throw new Error(`index ${index} ${startAt}: ${error.message}`); })
          ).rows[0]!.r,
        );
        reasons.push(result.ok ? "ok" : result.reason);
      }
      expect(reasons.slice(0, 8).every((r) => r === "ok")).toBe(true);
      expect(reasons[8]).toBe("too_many_from_network");
    });
  });

  it("[REPRO] pogađanje tuđih brojeva: 30 pretraga sa različitim p_network_hash prolazi, limit je 20 po satu", async () => {
    await withRollback(async (db) => {
      const salon = await salonWithManySlots(db);
      const clientId = await createClient(db, salon.tenantId, mobile(1));
      await insertAppointment(db, {
        tenantId: salon.tenantId,
        staffId: salon.staffId,
        serviceId: salon.serviceId,
        clientId,
        startAt: await instant(db, 5, "10:00"),
      });
      await db.query("select set_config('request.headers', $1, true)", [
        JSON.stringify({ "x-real-ip": "198.51.100.9" }),
      ]);

      let visible = 0;
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const rows = await asAnon(db, async () =>
          (
            await db.query<{ r: unknown[] }>(
              "select public_appointments_for_phone($1,$2,$3) as r",
              [salon.slug, mobile(1), `hash-${attempt}`],
            )
          ).rows[0]!.r,
        );
        if (rows.length > 0) visible += 1;
      }

      expect(visible).toBeLessThanOrEqual(20);
    });
  });
});

describe("log_error", () => {
  it("[REPRO] anonimna poplava od 60 max-veličine redova ne sme da ugasi evidenciju pravih grešaka", async () => {
    await withRollback(async (db) => {
      await db.query("delete from error_events");
      const huge = "x".repeat(8000);

      for (let index = 0; index < 60; index += 1) {
        await asAnon(db, () =>
          db.query("select log_error('client', $1, null, '/x', $2, 'ua')", [
            `flood ${index}`,
            huge,
          ]),
        );
      }

      // Prava greška servera stiže u istom minutu.
      await db.query("select log_error('server', 'prava greska', null, '/dashboard', 'stack', 'ua')");

      const real = await db.query(
        "select count(*)::int as n from error_events where message = 'prava greska'",
      );
      const size = await db.query<{ bytes: string }>(
        "select sum(length(stack) + length(message))::bigint as bytes from error_events",
      );
      expect(
        real.rows[0].n,
        `60 redova = ${size.rows[0]!.bytes} znakova (sirovo, pre kompresije)`,
      ).toBe(1);
    });
  });
});

describe("appointment_events kao dokaz", () => {
  it("[REPRO] vlasnica salona ne sme da upiše događaj 'otkazala klijentkinja' koji se nije desio", async () => {
    await withRollback(async (db) => {
      const tenantId = await createTenant(db);
      const userId = await createUser(db, tenantId);
      const staffId = await createStaff(db, tenantId);
      const serviceId = await createService(db, tenantId);
      const clientId = await createClient(db, tenantId);
      const appointment = await insertAppointment(db, {
        tenantId,
        staffId,
        serviceId,
        clientId,
        startAt: new Date(Date.now() + 5 * 864e5).toISOString(),
      });

      let forged = false;
      await asUser(db, userId, async () => {
        try {
          await db.query("savepoint forge");
          await db.query(
            `insert into appointment_events
               (tenant_id, appointment_id, from_status, to_status, actor_type, device_id)
             values ($1,$2,'confirmed','cancelled_by_client','client','forged-device')`,
            [tenantId, appointment.id],
          );
          forged = true;
        } catch {
          await db.query("rollback to savepoint forge");
        }
      });

      expect(forged).toBe(false);
    });
  });
});

describe("brisanje termina i trag", () => {
  it("[REPRO] vlasnica koja obriše termin ne sme da obriše i dokaz o tome ko ga je otkazao", async () => {
    await withRollback(async (db) => {
      const tenantId = await createTenant(db);
      const userId = await createUser(db, tenantId);
      const staffId = await createStaff(db, tenantId);
      const serviceId = await createService(db, tenantId);
      const clientId = await createClient(db, tenantId);
      const appointment = await insertAppointment(db, {
        tenantId, staffId, serviceId, clientId,
        startAt: new Date(Date.now() + 5 * 864e5).toISOString(),
      });

      const before = await db.query(
        "select count(*)::int as n from appointment_events where appointment_id=$1", [appointment.id]);
      expect(before.rows[0].n).toBe(1);

      await asUser(db, userId, async () => {
        await db.query("delete from appointments where id=$1", [appointment.id]);
      });

      const after = await db.query(
        "select count(*)::int as n from appointment_events where appointment_id=$1", [appointment.id]);
      expect(after.rows[0].n).toBe(1);
    });
  });
});

describe("blocklist i limit po broju", () => {
  it("[REPRO] blokiran broj ne zaobilazi se upisom sa nulom posle +381 (isti telefon, drugi string)", async () => {
    await withRollback(async (db) => {
      const salon = await salonWithManySlots(db);
      const owner = await createUser(db, salon.tenantId);
      await db.query(
        "insert into blocklist (tenant_id, phone_e164, reason, created_by) values ($1,'+38164123456','test',$2)",
        [salon.tenantId, owner],
      );

      const call = async (phone: string, day: number) =>
        asAnon(db, async () =>
          (
            await db.query<{ r: { ok: boolean; reason?: string } }>(
              "select public_book($1,$2,$3,'Bot',$4,null,null) as r",
              [salon.slug, salon.serviceId, await instant(db, day, "10:00"), phone],
            )
          ).rows[0]!.r,
        );

      const canonical = await call("+38164123456", 3);
      const variant = await call("+381064123456", 4);

      expect({ canonical: canonical.reason, variantOk: variant.ok }).toEqual({
        canonical: "blocked",
        variantOk: false,
      });
    });
  });
});
