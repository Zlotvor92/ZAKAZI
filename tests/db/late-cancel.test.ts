import { createHash, randomBytes } from "node:crypto";
import type pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import {
  asAnon,
  asServer,
  asUser,
  closePool,
  inSavepoint,
  createClient,
  createService,
  createStaff,
  createTenant,
  createUser,
  insertAppointment,
  withRollback,
} from "./helpers";

afterAll(closePool);

const PHONE = "+381645554101";
const OTHER_PHONE = "+381645554102";

type BookResult = { ok: boolean; reason?: string };
type CancelResult = { ok: boolean; reason?: string };

async function openSalon(db: pg.PoolClient) {
  const tenantId = await createTenant(db);
  const userId = await createUser(db, tenantId);
  const staffId = await createStaff(db, tenantId);
  const serviceId = await createService(db, tenantId, 90);
  await db.query(
    "insert into staff_services (tenant_id, staff_id, service_id) values ($1, $2, $3)",
    [tenantId, staffId, serviceId],
  );
  await db.query(
    `insert into working_hours
       (tenant_id, staff_id, weekday, start_time, end_time, slot_minutes)
     values ($1, $2, 1, '09:00', '18:00', 90)`,
    [tenantId, staffId],
  );
  await db.query(
    `update tenants set booking_horizon_days = 90, min_lead_minutes = 0,
       public_booking_enabled = true where id = $1`,
    [tenantId],
  );
  const slug = await db.query<{ slug: string }>(
    "select slug from tenants where id = $1",
    [tenantId],
  );
  return { tenantId, userId, staffId, serviceId, slug: slug.rows[0]!.slug };
}

type Salon = Awaited<ReturnType<typeof openSalon>>;

/**
 * Termin koji klijentkinja može da otkaže preko sajta: tajna stoji u bazi kao
 * heš, isto kao kad ga upiše `public_book`.
 */
async function appointmentIn(
  db: pg.PoolClient,
  salon: Salon,
  phone: string,
  hours: number,
) {
  const existing = await db.query<{ id: string }>(
    "select id from clients where tenant_id = $1 and phone_e164 = $2",
    [salon.tenantId, phone],
  );
  const clientId =
    existing.rows[0]?.id ?? (await createClient(db, salon.tenantId, phone));
  const { rows } = await db.query<{ t: string }>(
    "select (now() + make_interval(hours => $1))::text as t",
    [hours],
  );
  const appointment = await insertAppointment(db, {
    tenantId: salon.tenantId,
    staffId: salon.staffId,
    serviceId: salon.serviceId,
    clientId,
    startAt: rows[0]!.t,
  });
  const secret = randomBytes(32).toString("base64url");
  await db.query(
    "update appointments set manage_proof_hash = $1 where id = $2",
    [createHash("sha256").update(secret).digest("hex"), appointment.id],
  );

  return { id: appointment.id, secret };
}

async function cancel(
  db: pg.PoolClient,
  salon: Salon,
  phone: string,
  appointment: { id: string; secret: string },
): Promise<CancelResult> {
  const result = await asServer(db, () =>
    db.query<{ result: CancelResult }>(
      "select public_cancel_appointment($1, $2, $3, $4::text[], null, null) as result",
      [salon.slug, phone, appointment.id, [appointment.secret]],
    ),
  );
  return result.rows[0]!.result;
}

/** Zakazivanje za ponedeljak koji je bar nedelju dana daleko. */
async function book(
  db: pg.PoolClient,
  salon: Salon,
  phone: string,
): Promise<BookResult> {
  const at = await db.query<{ at: string }>(
    `select to_char(
       (date_trunc('week', (now() at time zone 'Europe/Belgrade')::date + 14)::date
         + '09:00'::time) at time zone 'Europe/Belgrade',
       'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM') as at`,
  );
  const result = await asAnon(db, () =>
    asServer(db, () =>
      db.query<{ result: BookResult }>(
        "select public_book($1, $2, $3, 'Test', $4, null, null) as result",
        [salon.slug, salon.serviceId, at.rows[0]!.at, phone],
      ),
    ),
  );
  return result.rows[0]!.result;
}

async function lateCancel(db: pg.PoolClient, salon: Salon, phone: string, hours: number) {
  const appointment = await appointmentIn(db, salon, phone, hours);
  const result = await cancel(db, salon, phone, appointment);
  expect(result.ok).toBe(true);
  return appointment.id;
}

async function pardon(db: pg.PoolClient, salon: Salon, phone: string) {
  const client = await db.query<{ id: string }>(
    "select id from clients where tenant_id = $1 and phone_e164 = $2",
    [salon.tenantId, phone],
  );
  const result = await asUser(db, salon.userId, () =>
    db.query<{ result: { ok: boolean; reason?: string } }>(
      "select pardon_late_cancellations($1) as result",
      [client.rows[0]!.id],
    ),
  );
  return result.rows[0]!.result;
}

async function pardonCount(db: pg.PoolClient, salon: Salon) {
  const result = await db.query<{ n: string }>(
    "select count(*)::text as n from late_cancel_pardons where tenant_id = $1",
    [salon.tenantId],
  );
  return Number(result.rows[0]!.n);
}

describe("otkazivanje manje od 24 sata pre termina", () => {
  it("prolazi i upisuje se u audit log kao otkazivanje klijentkinje", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);
      const appointment = await appointmentIn(db, salon, PHONE, 2);

      const result = await cancel(db, salon, PHONE, appointment);

      expect(result.ok).toBe(true);
      const status = await db.query<{ status: string }>(
        "select status from appointments where id = $1",
        [appointment.id],
      );
      expect(status.rows[0]!.status).toBe("cancelled_by_client");
      const events = await db.query<{ actor_type: string }>(
        `select actor_type from appointment_events
         where appointment_id = $1 and to_status = 'cancelled_by_client'`,
        [appointment.id],
      );
      expect(events.rows.map((row) => row.actor_type)).toEqual(["client"]);
    });
  });
});

describe("dva kasna otkazivanja zaključavaju samostalno zakazivanje", () => {
  it("posle jednog kasnog otkazivanja zakazivanje i dalje radi", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);
      await lateCancel(db, salon, PHONE, 2);

      expect((await book(db, salon, PHONE)).ok).toBe(true);
    });
  });

  it("posle dva kasna otkazivanja sajt odbija zakazivanje", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);
      await lateCancel(db, salon, PHONE, 2);
      await lateCancel(db, salon, PHONE, 5);

      expect(await book(db, salon, PHONE)).toEqual({
        ok: false,
        reason: "too_many_late_cancellations",
      });
    });
  });

  it("otkazivanje više od 24 sata unapred se ne računa", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);
      await lateCancel(db, salon, PHONE, 30);
      await lateCancel(db, salon, PHONE, 48);
      await lateCancel(db, salon, PHONE, 72);

      expect((await book(db, salon, PHONE)).ok).toBe(true);
    });
  });

  it("jedno kasno i jedno rano otkazivanje su samo jedan kasni", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);
      await lateCancel(db, salon, PHONE, 2);
      await lateCancel(db, salon, PHONE, 48);

      expect((await book(db, salon, PHONE)).ok).toBe(true);
    });
  });

  it("drugi broj u istom salonu nije pogođen", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);
      await lateCancel(db, salon, PHONE, 2);
      await lateCancel(db, salon, PHONE, 5);

      expect((await book(db, salon, OTHER_PHONE)).ok).toBe(true);
    });
  });

  it("isti broj u drugom salonu nije pogođen", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);
      const other = await openSalon(db);
      await lateCancel(db, salon, PHONE, 2);
      await lateCancel(db, salon, PHONE, 5);

      expect((await book(db, other, PHONE)).ok).toBe(true);
    });
  });

  it("izuzet broj ne ostaje zaključan", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);
      await db.query(
        "insert into limit_exempt_phones (tenant_id, phone_e164, note) values ($1, $2, 'test')",
        [salon.tenantId, PHONE],
      );
      await lateCancel(db, salon, PHONE, 2);
      await lateCancel(db, salon, PHONE, 5);

      expect((await book(db, salon, PHONE)).ok).toBe(true);
    });
  });

  it("kad salon sam označi termin kao otkazan od klijentkinje, ne računa se", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);
      const clientId = await createClient(db, salon.tenantId, PHONE);

      for (const hours of [2, 5]) {
        const { rows } = await db.query<{ t: string }>(
          "select (now() + make_interval(hours => $1))::text as t",
          [hours],
        );
        const appointment = await insertAppointment(db, {
          tenantId: salon.tenantId,
          staffId: salon.staffId,
          serviceId: salon.serviceId,
          clientId,
          startAt: rows[0]!.t,
        });
        await asUser(db, salon.userId, () =>
          db.query("select change_appointment_status($1, 'cancelled_by_client', null)", [
            appointment.id,
          ]),
        );
      }

      expect((await book(db, salon, PHONE)).ok).toBe(true);
    });
  });

  it("salon i posle zaključavanja može da upiše termin iz kalendara", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);
      await lateCancel(db, salon, PHONE, 2);
      await lateCancel(db, salon, PHONE, 5);
      const startAt = new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString();

      const result = await asUser(db, salon.userId, () =>
        db.query<{ result: { ok: boolean } }>(
          "select create_appointment($1, $2, 90, 'Jelena', $3, null, null) as result",
          [salon.serviceId, startAt, PHONE],
        ),
      );

      expect(result.rows[0]!.result.ok).toBe(true);
    });
  });
});

describe("spisak termina kaže koji se računa kao kasan", () => {
  it("`late` je tačan pre i posle 24 sata", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);
      const near = await appointmentIn(db, salon, PHONE, 3);
      const far = await appointmentIn(db, salon, PHONE, 72);

      const result = await asServer(db, () =>
        db.query<{ data: { id: string; late: boolean }[] }>(
          "select public_appointments_for_proof($1, $2, $3::text[], null) as data",
          [salon.slug, PHONE, [near.secret, far.secret]],
        ),
      );

      expect(result.rows[0]!.data.map((row) => [row.id, row.late])).toEqual([
        [near.id, true],
        [far.id, false],
      ]);
    });
  });
});

describe("salon oprašta kasna otkazivanja", () => {
  it("posle oproštaja zaključani broj ponovo može da zakaže", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);
      await lateCancel(db, salon, PHONE, 2);
      await lateCancel(db, salon, PHONE, 5);
      expect((await book(db, salon, PHONE)).reason).toBe(
        "too_many_late_cancellations",
      );

      expect(await pardon(db, salon, PHONE)).toEqual({ ok: true });

      expect((await book(db, salon, PHONE)).ok).toBe(true);
    });
  });

  it("brojač posle oproštaja kreće od nule: treba opet dva kasna", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);
      await lateCancel(db, salon, PHONE, 2);
      await lateCancel(db, salon, PHONE, 5);
      await pardon(db, salon, PHONE);
      // Prošlost se pomera ručno: stara otkazivanja (i njihovi termini, da
      // ostanu „kasna") pre tri dana, oproštaj pre dva. Tri dana, da dnevno
      // ograničenje otkazivanja ne smeta novim.
      await db.query(
        `update appointment_events set created_at = created_at - interval '3 days'
         where tenant_id = $1`,
        [salon.tenantId],
      );
      await db.query(
        `update appointments set start_at = start_at - interval '3 days'
         where tenant_id = $1`,
        [salon.tenantId],
      );
      await db.query(
        `update late_cancel_pardons set created_at = now() - interval '2 days'
         where tenant_id = $1`,
        [salon.tenantId],
      );

      await lateCancel(db, salon, PHONE, 8);
      expect((await book(db, salon, PHONE)).ok).toBe(true);

      await lateCancel(db, salon, PHONE, 11);
      expect((await book(db, salon, PHONE)).reason).toBe(
        "too_many_late_cancellations",
      );
    });
  });

  it("audit log ostaje netaknut", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);
      await lateCancel(db, salon, PHONE, 2);
      await lateCancel(db, salon, PHONE, 5);
      const before = await db.query<{ n: string }>(
        "select count(*)::text as n from appointment_events where tenant_id = $1",
        [salon.tenantId],
      );

      await pardon(db, salon, PHONE);

      const after = await db.query<{ n: string }>(
        "select count(*)::text as n from appointment_events where tenant_id = $1",
        [salon.tenantId],
      );
      expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
    });
  });

  it("upisuje ko je i kada oprostio, a ništa kad nema šta da se oprosti", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);
      await createClient(db, salon.tenantId, PHONE);
      await pardon(db, salon, PHONE);
      expect(await pardonCount(db, salon)).toBe(0);

      await lateCancel(db, salon, PHONE, 2);
      await pardon(db, salon, PHONE);

      const rows = await db.query<{ created_by: string; phone_e164: string }>(
        "select created_by, phone_e164 from late_cancel_pardons where tenant_id = $1",
        [salon.tenantId],
      );
      expect(rows.rows).toEqual([{ created_by: salon.userId, phone_e164: PHONE }]);
    });
  });

  it("salon ne može da oprosti klijentkinju drugog salona", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);
      const other = await openSalon(db);
      await lateCancel(db, salon, PHONE, 2);
      await lateCancel(db, salon, PHONE, 5);
      const client = await db.query<{ id: string }>(
        "select id from clients where tenant_id = $1",
        [salon.tenantId],
      );

      const result = await asUser(db, other.userId, () =>
        db.query<{ result: { ok: boolean; reason?: string } }>(
          "select pardon_late_cancellations($1) as result",
          [client.rows[0]!.id],
        ),
      );

      expect(result.rows[0]!.result).toEqual({ ok: false, reason: "not_found" });
      expect(await pardonCount(db, salon)).toBe(0);
      expect((await book(db, salon, PHONE)).reason).toBe(
        "too_many_late_cancellations",
      );
    });
  });

  it("oproštaj se ne upisuje za tuđ salon ni direktno", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);
      const other = await openSalon(db);

      await asUser(db, other.userId, async () => {
        await expect(
          inSavepoint(db, () =>
            db.query(
              "insert into late_cancel_pardons (tenant_id, phone_e164) values ($1, $2)",
              [salon.tenantId, PHONE],
            ),
          ),
        ).rejects.toThrow(/row-level security/i);
      });
    });
  });

  it("oproštaj se ne menja ni briše, ni od vlasnice", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);
      await lateCancel(db, salon, PHONE, 2);
      await pardon(db, salon, PHONE);

      await asUser(db, salon.userId, async () => {
        await expect(
          inSavepoint(db, () => db.query("delete from late_cancel_pardons")),
        ).rejects.toThrow(/permission denied/i);
        await expect(
          inSavepoint(db, () =>
            db.query("update late_cancel_pardons set created_at = now()"),
          ),
        ).rejects.toThrow(/permission denied/i);
      });
    });
  });

  it("neulogovan posetilac ne dolazi do oproštaja", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);
      const clientId = await createClient(db, salon.tenantId, PHONE);

      await asAnon(db, async () => {
        await expect(
          inSavepoint(db, () =>
            db.query("select pardon_late_cancellations($1)", [clientId]),
          ),
        ).rejects.toThrow(/permission denied/i);
        await expect(
          inSavepoint(db, () => db.query("select 1 from late_cancel_pardons")),
        ).rejects.toThrow(/permission denied/i);
      });
    });
  });

  it("kartica klijentkinje pokazuje broj i zaključanost, pa nulu posle oproštaja", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);
      await lateCancel(db, salon, PHONE, 2);
      const last = await lateCancel(db, salon, PHONE, 5);
      const card = () =>
        asUser(db, salon.userId, async () => {
          const result = await db.query<{
            card: { late_cancellations: number; late_cancel_locked: boolean };
          }>("select client_card($1) as card", [last]);
          return result.rows[0]!.card;
        });

      expect(await card()).toMatchObject({
        late_cancellations: 2,
        late_cancel_locked: true,
      });

      await pardon(db, salon, PHONE);

      expect(await card()).toMatchObject({
        late_cancellations: 0,
        late_cancel_locked: false,
      });
    });
  });
});
