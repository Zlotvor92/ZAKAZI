import type pg from "pg";
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
} from "./helpers";

afterAll(closePool);

type Summary = {
  name: string;
  slug: string;
  timezone: string;
  logo_url: string | null;
} | null;

type UpcomingAppointment = {
  id: string;
  start_at: string;
  end_at: string;
  service_name: string;
  price_rsd: number;
};

type CancelResult =
  | {
      ok: true;
      appointment: {
        id: string;
        tenant_id: string;
        timezone: string;
        start_at: string;
        end_at: string;
        client_name: string;
        service_name: string;
      };
    }
  | { ok: false; reason: string };

async function summary(db: pg.PoolClient, slug: string): Promise<Summary> {
  const result = await db.query<{ data: Summary }>(
    "select public_salon_summary($1) as data",
    [slug],
  );
  return result.rows[0]!.data;
}

async function upcoming(
  db: pg.PoolClient,
  slug: string,
  phone: string,
): Promise<UpcomingAppointment[]> {
  const result = await db.query<{ data: UpcomingAppointment[] }>(
    "select public_appointments_for_phone($1, $2) as data",
    [slug, phone],
  );
  return result.rows[0]!.data;
}

async function cancel(
  db: pg.PoolClient,
  input: {
    slug: string;
    phone: string;
    appointmentId: string;
    deviceId?: string;
    networkHash?: string;
  },
): Promise<CancelResult> {
  const result = await db.query<{ result: CancelResult }>(
    "select public_cancel_appointment($1, $2, $3, $4, $5) as result",
    [
      input.slug,
      input.phone,
      input.appointmentId,
      input.deviceId ?? null,
      input.networkHash ?? null,
    ],
  );
  return result.rows[0]!.result;
}

async function salonWithAppointment(
  db: pg.PoolClient,
  phone: string,
  options: { startAt?: string; status?: string } = {},
) {
  const tenantId = await createTenant(db);
  const staffId = await createStaff(db, tenantId);
  const serviceId = await createService(db, tenantId);
  const clientId = await createClient(db, tenantId, phone);
  const appointment = await insertAppointment(db, {
    tenantId,
    staffId,
    serviceId,
    clientId,
    startAt: options.startAt ?? "2026-09-14T08:00:00Z",
    status: options.status ?? "confirmed",
  });

  const slug = await db.query<{ slug: string }>(
    "select slug from tenants where id = $1",
    [tenantId],
  );

  return { tenantId, staffId, serviceId, clientId, appointmentId: appointment.id, slug: slug.rows[0]!.slug };
}

describe("ime i boje salona za otkazivanje", () => {
  it("vraća salon koji nije suspendovan", async () => {
    await withRollback(async (db) => {
      const tenantId = await createTenant(db);
      const slug = await db.query<{ slug: string }>(
        "select slug from tenants where id = $1",
        [tenantId],
      );

      const data = await asAnon(db, () => summary(db, slug.rows[0]!.slug));
      expect(data?.slug).toBe(slug.rows[0]!.slug);
    });
  });

  it("radi i kad je zakazivanje ručno isključeno", async () => {
    await withRollback(async (db) => {
      const tenantId = await createTenant(db);
      await db.query(
        "update tenants set public_booking_enabled = false where id = $1",
        [tenantId],
      );
      const slug = await db.query<{ slug: string }>(
        "select slug from tenants where id = $1",
        [tenantId],
      );

      const data = await asAnon(db, () => summary(db, slug.rows[0]!.slug));
      expect(data).not.toBeNull();
    });
  });

  it("ne postoji za suspendovan salon", async () => {
    await withRollback(async (db) => {
      const tenantId = await createTenant(db);
      await db.query("update tenants set suspended_at = now() where id = $1", [
        tenantId,
      ]);
      const slug = await db.query<{ slug: string }>(
        "select slug from tenants where id = $1",
        [tenantId],
      );

      const data = await asAnon(db, () => summary(db, slug.rows[0]!.slug));
      expect(data).toBeNull();
    });
  });

  it("nepostojeći salon vraća null, ne grešku", async () => {
    await withRollback(async (db) => {
      expect(await asAnon(db, () => summary(db, "nema-ovoga"))).toBeNull();
    });
  });
});

describe("spisak termina po broju telefona", () => {
  it("vraća samo buduće pending/confirmed termine tog broja", async () => {
    await withRollback(async (db) => {
      const phone = "+381645551001";
      const base = await salonWithAppointment(db, phone);

      const list = await asAnon(db, () => upcoming(db, base.slug, phone));

      expect(list).toHaveLength(1);
      expect(list[0]!.id).toBe(base.appointmentId);
    });
  });

  it("ne vraća termin drugog broja", async () => {
    await withRollback(async (db) => {
      const base = await salonWithAppointment(db, "+381645551002");

      const list = await asAnon(db, () =>
        upcoming(db, base.slug, "+381645559999"),
      );

      expect(list).toEqual([]);
    });
  });

  it("ne vraća termin drugog salona ni za isti broj", async () => {
    await withRollback(async (db) => {
      const phone = "+381645551003";
      await salonWithAppointment(db, phone);
      const otherTenantId = await createTenant(db);
      const otherSlug = await db.query<{ slug: string }>(
        "select slug from tenants where id = $1",
        [otherTenantId],
      );

      const list = await asAnon(db, () =>
        upcoming(db, otherSlug.rows[0]!.slug, phone),
      );

      expect(list).toEqual([]);
    });
  });

  it("ne vraća prošao ni otkazan termin", async () => {
    await withRollback(async (db) => {
      const phone = "+381645551004";
      const past = await salonWithAppointment(db, phone, {
        startAt: "2020-01-01T08:00:00Z",
      });

      const tenantId = past.tenantId;
      const staffId = past.staffId;
      const serviceId = past.serviceId;
      const clientId = past.clientId;

      const cancelled = await insertAppointment(db, {
        tenantId,
        staffId,
        serviceId,
        clientId,
        startAt: "2026-09-20T08:00:00Z",
        status: "cancelled_by_client",
      });

      const list = await asAnon(db, () => upcoming(db, past.slug, phone));

      expect(list.map((row) => row.id)).not.toContain(past.appointmentId);
      expect(list.map((row) => row.id)).not.toContain(cancelled.id);
    });
  });

  it("nepoznat broj i suspendovan salon se razlikuju: prazna lista naspram null", async () => {
    await withRollback(async (db) => {
      expect(await asAnon(db, () => upcoming(db, "nema-ovoga", "+381600000000"))).toBeNull();
    });
  });
});

describe("otkazivanje termina brojem telefona", () => {
  it("prebacuje termin u cancelled_by_client i ostavlja trag u istoriji", async () => {
    await withRollback(async (db) => {
      const phone = "+381645552001";
      const base = await salonWithAppointment(db, phone);

      const result = await asAnon(db, () =>
        cancel(db, {
          slug: base.slug,
          phone,
          appointmentId: base.appointmentId,
          deviceId: "uredjaj-1",
        }),
      );

      expect(result.ok).toBe(true);

      const row = await db.query<{ status: string }>(
        "select status from appointments where id = $1",
        [base.appointmentId],
      );
      expect(row.rows[0]!.status).toBe("cancelled_by_client");

      const event = await db.query<{
        actor_type: string;
        device_id: string | null;
        to_status: string;
      }>(
        `select actor_type, device_id, to_status from appointment_events
         where appointment_id = $1 order by created_at desc limit 1`,
        [base.appointmentId],
      );
      expect(event.rows[0]).toEqual({
        actor_type: "client",
        device_id: "uredjaj-1",
        to_status: "cancelled_by_client",
      });
    });
  });

  it("oslobađa termin za novo zakazivanje u istom slotu", async () => {
    await withRollback(async (db) => {
      const phone = "+381645552002";
      const base = await salonWithAppointment(db, phone);

      await asAnon(db, () =>
        cancel(db, { slug: base.slug, phone, appointmentId: base.appointmentId }),
      );

      // Isti slot, drugi klijent — exclusion ograničenje bi odbilo da je stari
      // termin i dalje aktivan.
      const other = await createClient(db, base.tenantId, "+381645559998");
      await expect(
        insertAppointment(db, {
          tenantId: base.tenantId,
          staffId: base.staffId,
          serviceId: base.serviceId,
          clientId: other,
          startAt: "2026-09-14T08:00:00Z",
        }),
      ).resolves.toBeDefined();
    });
  });

  it("pogrešan broj telefona ne otkazuje tuđ termin", async () => {
    await withRollback(async (db) => {
      const base = await salonWithAppointment(db, "+381645552003");

      const result = await asAnon(db, () =>
        cancel(db, {
          slug: base.slug,
          phone: "+381645559997",
          appointmentId: base.appointmentId,
        }),
      );

      expect(result).toEqual({ ok: false, reason: "not_found" });

      const row = await db.query<{ status: string }>(
        "select status from appointments where id = $1",
        [base.appointmentId],
      );
      expect(row.rows[0]!.status).toBe("confirmed");
    });
  });

  it("termin drugog salona se ne otkazuje ni uz tačan broj", async () => {
    await withRollback(async (db) => {
      const phone = "+381645552004";
      const base = await salonWithAppointment(db, phone);
      const otherTenantId = await createTenant(db);
      const otherSlug = await db.query<{ slug: string }>(
        "select slug from tenants where id = $1",
        [otherTenantId],
      );

      const result = await asAnon(db, () =>
        cancel(db, {
          slug: otherSlug.rows[0]!.slug,
          phone,
          appointmentId: base.appointmentId,
        }),
      );

      expect(result).toEqual({ ok: false, reason: "not_found" });
    });
  });

  it("završen termin se ne može otkazati", async () => {
    await withRollback(async (db) => {
      const phone = "+381645552005";
      const base = await salonWithAppointment(db, phone, { status: "completed" });

      const result = await asAnon(db, () =>
        cancel(db, { slug: base.slug, phone, appointmentId: base.appointmentId }),
      );

      expect(result).toEqual({ ok: false, reason: "invalid_transition" });
    });
  });

  it("već otkazan termin kaže da je već otkazan", async () => {
    // Dve kartice ili dupli dodir na dugme. Klijentkinja je dobila tačno ono
    // što je htela, pa poruka ne sme da je šalje da zove salon.
    await withRollback(async (db) => {
      const phone = "+381645552006";
      const base = await salonWithAppointment(db, phone);

      const first = await asAnon(db, () =>
        cancel(db, { slug: base.slug, phone, appointmentId: base.appointmentId }),
      );
      expect(first.ok).toBe(true);

      const second = await asAnon(db, () =>
        cancel(db, { slug: base.slug, phone, appointmentId: base.appointmentId }),
      );
      expect(second).toEqual({ ok: false, reason: "already_cancelled" });
    });
  });

  it("prošao termin i dalje upućuje na salon", async () => {
    // Granica prethodnog testa: `completed` i `no_show` nisu otkazani, tu je
    // „javi se salonu" tačan odgovor i mora da ostane.
    await withRollback(async (db) => {
      for (const status of ["completed", "no_show"]) {
        const phone = "+381645552016";
        const base = await salonWithAppointment(db, phone);
        await db.query("update appointments set status = $1 where id = $2", [
          status,
          base.appointmentId,
        ]);

        const result = await asAnon(db, () =>
          cancel(db, {
            slug: base.slug,
            phone,
            appointmentId: base.appointmentId,
          }),
        );

        expect({ status, result }).toEqual({
          status,
          result: { ok: false, reason: "invalid_transition" },
        });
      }
    });
  });

  it("suspendovan salon odbija otkazivanje", async () => {
    await withRollback(async (db) => {
      const phone = "+381645552007";
      const base = await salonWithAppointment(db, phone);
      await db.query("update tenants set suspended_at = now() where id = $1", [
        base.tenantId,
      ]);

      const result = await asAnon(db, () =>
        cancel(db, { slug: base.slug, phone, appointmentId: base.appointmentId }),
      );

      expect(result).toEqual({ ok: false, reason: "not_found" });
    });
  });

  it("prijavljena vlasnica takođe sme da pozove ovu funkciju preko broja klijentkinje", async () => {
    await withRollback(async (db) => {
      const phone = "+381645552008";
      const base = await salonWithAppointment(db, phone);
      const userId = await createUser(db, base.tenantId);

      const result = await asUser(db, userId, () =>
        cancel(db, { slug: base.slug, phone, appointmentId: base.appointmentId }),
      );

      expect(result.ok).toBe(true);
    });
  });
});
