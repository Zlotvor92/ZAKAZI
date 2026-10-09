import { createHash, randomBytes } from "node:crypto";
import type pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import {
  asAnon,
  asServer,
  asUser,
  closePool,
  createClient,
  createService,
  createStaff,
  createTenant,
  createUser,
  futureStartAt,
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
  late: boolean;
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

type BookResult =
  | { ok: true; replayed?: boolean; appointment: { id: string } }
  | { ok: false; reason: string };

/** Isti oblik koji pravi pregledač: 32 nasumična bajta, base64url, 43 znaka. */
function newSecret(): string {
  return randomBytes(32).toString("base64url");
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

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
  secrets: string[],
  deviceId: string | null = null,
): Promise<UpcomingAppointment[] | null> {
  const result = await asServer(db, () =>
    db.query<{ data: UpcomingAppointment[] | null }>(
      "select public_appointments_for_proof($1, $2, $3::text[], $4) as data",
      [slug, phone, secrets, deviceId],
    ),
  );
  return result.rows[0]!.data;
}

async function cancel(
  db: pg.PoolClient,
  input: {
    slug: string;
    phone: string;
    appointmentId: string;
    secrets: string[];
    deviceId?: string;
    networkHash?: string;
  },
): Promise<CancelResult> {
  const result = await asServer(db, () =>
    db.query<{ result: CancelResult }>(
      "select public_cancel_appointment($1, $2, $3, $4::text[], $5, $6) as result",
      [
        input.slug,
        input.phone,
        input.appointmentId,
        input.secrets,
        input.deviceId ?? null,
        input.networkHash ?? null,
      ],
    ),
  );
  return result.rows[0]!.result;
}

/**
 * Salon sa jednim terminom koji nosi tajnu. Termin je upisan direktno, a tajna
 * se čuva kao heš, isto kao kad ga upiše `public_book`.
 */
async function salonWithAppointment(
  db: pg.PoolClient,
  phone: string,
  options: { startAt?: string; status?: string } = {},
) {
  const tenantId = await createTenant(db);
  const staffId = await createStaff(db, tenantId);
  const serviceId = await createService(db, tenantId);
  const clientId = await createClient(db, tenantId, phone);
  const secret = newSecret();
  const appointment = await insertAppointment(db, {
    tenantId,
    staffId,
    serviceId,
    clientId,
    startAt: options.startAt ?? futureStartAt(),
    status: options.status ?? "confirmed",
  });
  await db.query(
    "update appointments set manage_proof_hash = $1 where id = $2",
    [sha256Hex(secret), appointment.id],
  );

  const slug = await db.query<{ slug: string }>(
    "select slug from tenants where id = $1",
    [tenantId],
  );

  return {
    tenantId,
    staffId,
    serviceId,
    clientId,
    appointmentId: appointment.id,
    secret,
    slug: slug.rows[0]!.slug,
  };
}

async function slugOf(db: pg.PoolClient, tenantId: string): Promise<string> {
  const { rows } = await db.query<{ slug: string }>(
    "select slug from tenants where id = $1",
    [tenantId],
  );
  return rows[0]!.slug;
}

/** Salon sa radnim vremenom, za zakazivanje preko `public_book`. */
async function bookingSalon(db: pg.PoolClient) {
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
    "update tenants set min_lead_minutes = 0, booking_horizon_days = 30 where id = $1",
    [tenantId],
  );

  return { tenantId, staffId, serviceId, slug: await slugOf(db, tenantId) };
}

async function localInstant(db: pg.PoolClient, day: number, time: string) {
  const { rows } = await db.query<{ at: string }>(
    `select to_char((((now() at time zone 'Europe/Belgrade')::date + $1::int) + $2::time)
       at time zone 'Europe/Belgrade', 'YYYY-MM-DD"T"HH24:MI:SSOF') as at`,
    [day, time],
  );
  return rows[0]!.at;
}

/** Zakazivanje kakvo radi sajt: server šalje uređaj i, od sada, tajnu. */
async function book(
  db: pg.PoolClient,
  salon: { slug: string; serviceId: string },
  input: {
    phone: string;
    time: string;
    day?: number;
    secret?: string | null;
    deviceId?: string | null;
    requestId?: string | null;
  },
): Promise<BookResult> {
  const startAt = await localInstant(db, input.day ?? 3, input.time);
  const result = await asServer(db, () =>
    db.query<{ r: BookResult }>(
      `select public_book($1, $2, $3, 'Ana', $4, $5, null, $6, $7) as r`,
      [
        salon.slug,
        salon.serviceId,
        startAt,
        input.phone,
        input.deviceId ?? null,
        input.requestId ?? null,
        input.secret ?? null,
      ],
    ),
  );
  return result.rows[0]!.r;
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

describe("spisak termina: broj telefona i dokaz zajedno", () => {
  it("vraća budući termin kad se poklope broj i tajna", async () => {
    await withRollback(async (db) => {
      const phone = "+381645551001";
      const base = await salonWithAppointment(db, phone);

      const list = await upcoming(db, base.slug, phone, [base.secret]);

      expect(list).toHaveLength(1);
      expect(list![0]!.id).toBe(base.appointmentId);
    });
  });

  it("sam broj telefona ne otvara ništa: bez dokaza i sa tuđim dokazom", async () => {
    await withRollback(async (db) => {
      const phone = "+381645551002";
      const base = await salonWithAppointment(db, phone);

      expect(await upcoming(db, base.slug, phone, [])).toEqual([]);
      expect(await upcoming(db, base.slug, phone, [newSecret()])).toEqual([]);
      expect(await upcoming(db, base.slug, phone, [], "nepoznat-uredjaj")).toEqual(
        [],
      );
    });
  });

  it("sama tajna bez pravog broja ne otvara ništa", async () => {
    await withRollback(async (db) => {
      const base = await salonWithAppointment(db, "+381645551003");

      expect(
        await upcoming(db, base.slug, "+381645559999", [base.secret]),
      ).toEqual([]);
    });
  });

  it("odgovor je isti za pogrešan broj, tuđu tajnu i izostanak dokaza", async () => {
    // Razlika u odgovoru bi bila pitanje „postoji li termin za ovaj broj".
    await withRollback(async (db) => {
      const phone = "+381645551004";
      const base = await salonWithAppointment(db, phone);

      const answers = [
        await upcoming(db, base.slug, "+381645559999", [base.secret]),
        await upcoming(db, base.slug, phone, [newSecret()]),
        await upcoming(db, base.slug, phone, []),
        await upcoming(db, base.slug, "+381645559999", []),
      ];

      for (const answer of answers) {
        expect(answer).toEqual([]);
      }
    });
  });

  it("tajna jednog termina ne otvara drugi termin istog broja", async () => {
    await withRollback(async (db) => {
      const phone = "+381645551005";
      const base = await salonWithAppointment(db, phone);
      const second = await insertAppointment(db, {
        tenantId: base.tenantId,
        staffId: base.staffId,
        serviceId: base.serviceId,
        clientId: base.clientId,
        startAt: new Date(
          new Date(futureStartAt()).getTime() + 24 * 60 * 60 * 1000,
        ).toISOString(),
      });
      const secondSecret = newSecret();
      await db.query(
        "update appointments set manage_proof_hash = $1 where id = $2",
        [sha256Hex(secondSecret), second.id],
      );

      const onlyFirst = await upcoming(db, base.slug, phone, [base.secret]);
      expect(onlyFirst!.map((row) => row.id)).toEqual([base.appointmentId]);

      const both = await upcoming(db, base.slug, phone, [
        secondSecret,
        base.secret,
      ]);
      expect(both!.map((row) => row.id)).toEqual([
        base.appointmentId,
        second.id,
      ]);
    });
  });

  it("tajna iz jednog salona ne otvara termin drugog salona", async () => {
    await withRollback(async (db) => {
      const phone = "+381645551006";
      const base = await salonWithAppointment(db, phone);
      const otherSlug = await slugOf(db, await createTenant(db));

      expect(
        await upcoming(db, otherSlug, phone, [base.secret]),
      ).toEqual([]);
    });
  });

  it("ne vraća prošao ni otkazan termin", async () => {
    await withRollback(async (db) => {
      const phone = "+381645551007";
      const past = await salonWithAppointment(db, phone, {
        startAt: "2020-01-01T08:00:00Z",
      });

      const cancelled = await insertAppointment(db, {
        tenantId: past.tenantId,
        staffId: past.staffId,
        serviceId: past.serviceId,
        clientId: past.clientId,
        startAt: futureStartAt(),
        status: "cancelled_by_client",
      });
      await db.query(
        "update appointments set manage_proof_hash = $1 where id = $2",
        [sha256Hex(past.secret), cancelled.id],
      );

      const list = await upcoming(db, past.slug, phone, [past.secret]);

      expect(list).toEqual([]);
    });
  });

  it("nepostojeći salon vraća null, nepoznat broj prazan niz", async () => {
    await withRollback(async (db) => {
      expect(
        await upcoming(db, "nema-ovoga", "+381600000000", [newSecret()]),
      ).toBeNull();

      const base = await salonWithAppointment(db, "+381645551008");
      expect(
        await upcoming(db, base.slug, "+381645550000", [base.secret]),
      ).toEqual([]);
    });
  });

  it("suspendovan salon vraća null", async () => {
    await withRollback(async (db) => {
      const phone = "+381645551009";
      const base = await salonWithAppointment(db, phone);
      await db.query("update tenants set suspended_at = now() where id = $1", [
        base.tenantId,
      ]);

      expect(await upcoming(db, base.slug, phone, [base.secret])).toBeNull();
    });
  });

  it("gleda samo prvih deset tajni", async () => {
    // Zahtev ne sme da natera bazu na proizvoljno mnogo poređenja.
    await withRollback(async (db) => {
      const phone = "+381645551010";
      const base = await salonWithAppointment(db, phone);
      const filler = Array.from({ length: 10 }, () => newSecret());

      expect(
        await upcoming(db, base.slug, phone, [...filler, base.secret]),
      ).toEqual([]);
      expect(
        (await upcoming(db, base.slug, phone, [...filler.slice(1), base.secret]))!
          .length,
      ).toBe(1);
    });
  });
});

describe("otkazivanje: broj telefona i dokaz zajedno", () => {
  it("prebacuje termin u cancelled_by_client i ostavlja trag u istoriji", async () => {
    await withRollback(async (db) => {
      const phone = "+381645552001";
      const base = await salonWithAppointment(db, phone);

      const result = await asAnon(db, () =>
        cancel(db, {
          slug: base.slug,
          phone,
          appointmentId: base.appointmentId,
          secrets: [base.secret],
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
      const startAt = await db.query<{ start_at: string }>(
        "select start_at from appointments where id = $1",
        [base.appointmentId],
      );

      await asAnon(db, () =>
        cancel(db, {
          slug: base.slug,
          phone,
          appointmentId: base.appointmentId,
          secrets: [base.secret],
        }),
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
          startAt: startAt.rows[0]!.start_at,
        }),
      ).resolves.toBeDefined();
    });
  });

  it("sam broj telefona ne otkazuje tuđ termin", async () => {
    await withRollback(async (db) => {
      const phone = "+381645552003";
      const base = await salonWithAppointment(db, phone);

      for (const secrets of [[], [newSecret()]]) {
        const result = await asAnon(db, () =>
          cancel(db, {
            slug: base.slug,
            phone,
            appointmentId: base.appointmentId,
            secrets,
          }),
        );
        expect(result).toEqual({ ok: false, reason: "not_found" });
      }

      const row = await db.query<{ status: string }>(
        "select status from appointments where id = $1",
        [base.appointmentId],
      );
      expect(row.rows[0]!.status).toBe("confirmed");
    });
  });

  it("sama tajna sa pogrešnim brojem ne otkazuje", async () => {
    await withRollback(async (db) => {
      const base = await salonWithAppointment(db, "+381645552004");

      const result = await asAnon(db, () =>
        cancel(db, {
          slug: base.slug,
          phone: "+381645559997",
          appointmentId: base.appointmentId,
          secrets: [base.secret],
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

  it("tajna drugog termina istog broja ne otkazuje ovaj termin", async () => {
    await withRollback(async (db) => {
      const phone = "+381645552005";
      const base = await salonWithAppointment(db, phone);
      const second = await insertAppointment(db, {
        tenantId: base.tenantId,
        staffId: base.staffId,
        serviceId: base.serviceId,
        clientId: base.clientId,
        startAt: new Date(
          new Date(futureStartAt()).getTime() + 24 * 60 * 60 * 1000,
        ).toISOString(),
      });
      const secondSecret = newSecret();
      await db.query(
        "update appointments set manage_proof_hash = $1 where id = $2",
        [sha256Hex(secondSecret), second.id],
      );

      const result = await asAnon(db, () =>
        cancel(db, {
          slug: base.slug,
          phone,
          appointmentId: base.appointmentId,
          secrets: [secondSecret],
        }),
      );

      expect(result).toEqual({ ok: false, reason: "not_found" });
    });
  });

  it("nepostojeći termin i tuđ termin daju isti odgovor", async () => {
    await withRollback(async (db) => {
      const phone = "+381645552006";
      const base = await salonWithAppointment(db, phone);

      const missing = await asAnon(db, () =>
        cancel(db, {
          slug: base.slug,
          phone,
          appointmentId: crypto.randomUUID(),
          secrets: [newSecret()],
        }),
      );
      const foreign = await asAnon(db, () =>
        cancel(db, {
          slug: base.slug,
          phone,
          appointmentId: base.appointmentId,
          secrets: [newSecret()],
        }),
      );

      expect(missing).toEqual(foreign);
    });
  });

  it("termin drugog salona se ne otkazuje ni uz tačan broj i tajnu", async () => {
    await withRollback(async (db) => {
      const phone = "+381645552007";
      const base = await salonWithAppointment(db, phone);
      const otherSlug = await slugOf(db, await createTenant(db));

      const result = await asAnon(db, () =>
        cancel(db, {
          slug: otherSlug,
          phone,
          appointmentId: base.appointmentId,
          secrets: [base.secret],
        }),
      );

      expect(result).toEqual({ ok: false, reason: "not_found" });
    });
  });

  it("neispravan broj telefona se odbija", async () => {
    await withRollback(async (db) => {
      const base = await salonWithAppointment(db, "+381645552008");

      const result = await asAnon(db, () =>
        cancel(db, {
          slug: base.slug,
          phone: "064555",
          appointmentId: base.appointmentId,
          secrets: [base.secret],
        }),
      );

      expect(result).toEqual({ ok: false, reason: "invalid_phone" });
    });
  });

  it("broj sa nulom posle koda zemlje se ne prihvata", async () => {
    await withRollback(async (db) => {
      const base = await salonWithAppointment(db, "+381645552009");

      const result = await asAnon(db, () =>
        cancel(db, {
          slug: base.slug,
          phone: "+3810645552009",
          appointmentId: base.appointmentId,
          secrets: [base.secret],
        }),
      );

      expect(result).toEqual({ ok: false, reason: "invalid_phone" });
      expect(
        await upcoming(db, base.slug, "+3810645552009", [base.secret]),
      ).toEqual([]);
    });
  });

  it("završen termin se ne može otkazati", async () => {
    await withRollback(async (db) => {
      const phone = "+381645552010";
      const base = await salonWithAppointment(db, phone, {
        status: "completed",
      });

      const result = await asAnon(db, () =>
        cancel(db, {
          slug: base.slug,
          phone,
          appointmentId: base.appointmentId,
          secrets: [base.secret],
        }),
      );

      expect(result).toEqual({ ok: false, reason: "invalid_transition" });
    });
  });

  it("već otkazan termin kaže da je već otkazan", async () => {
    // Dve kartice ili dupli dodir na dugme. Klijentkinja je dobila tačno ono
    // što je htela, pa poruka ne sme da je šalje da zove salon.
    await withRollback(async (db) => {
      const phone = "+381645552011";
      const base = await salonWithAppointment(db, phone);
      const input = {
        slug: base.slug,
        phone,
        appointmentId: base.appointmentId,
        secrets: [base.secret],
      };

      const first = await asAnon(db, () => cancel(db, input));
      expect(first.ok).toBe(true);

      const second = await asAnon(db, () => cancel(db, input));
      expect(second).toEqual({ ok: false, reason: "already_cancelled" });
    });
  });

  it("prošao termin i dalje upućuje na salon", async () => {
    // Granica prethodnog testa: `completed` i `no_show` nisu otkazani, tu je
    // „javi se salonu" tačan odgovor i mora da ostane.
    await withRollback(async (db) => {
      for (const status of ["completed", "no_show"]) {
        const phone = "+381645552012";
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
            secrets: [base.secret],
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
      const phone = "+381645552013";
      const base = await salonWithAppointment(db, phone);
      await db.query("update tenants set suspended_at = now() where id = $1", [
        base.tenantId,
      ]);

      const result = await asAnon(db, () =>
        cancel(db, {
          slug: base.slug,
          phone,
          appointmentId: base.appointmentId,
          secrets: [base.secret],
        }),
      );

      expect(result).toEqual({ ok: false, reason: "not_found" });
    });
  });

  it("prijavljena vlasnica ne dobija ništa više od dokaza", async () => {
    await withRollback(async (db) => {
      const phone = "+381645552014";
      const base = await salonWithAppointment(db, phone);
      const userId = await createUser(db, base.tenantId);

      const without = await asUser(db, userId, () =>
        cancel(db, {
          slug: base.slug,
          phone,
          appointmentId: base.appointmentId,
          secrets: [],
        }),
      );
      expect(without).toEqual({ ok: false, reason: "not_found" });

      const withProof = await asUser(db, userId, () =>
        cancel(db, {
          slug: base.slug,
          phone,
          appointmentId: base.appointmentId,
          secrets: [base.secret],
        }),
      );
      expect(withProof.ok).toBe(true);
    });
  });
});

describe("zakazivanje čuva samo heš tajne", () => {
  it("u bazi stoji SHA-256 tajne, a tajne nigde nema", async () => {
    await withRollback(async (db) => {
      const salon = await bookingSalon(db);
      const secret = newSecret();

      const booked = await book(db, salon, {
        phone: "+381645123481",
        time: "10:00",
        secret,
        deviceId: "uredjaj-a",
      });
      expect(booked.ok).toBe(true);
      if (!booked.ok) {
        return;
      }

      const row = await db.query<{ hash: string; dump: string }>(
        `select manage_proof_hash as hash, to_jsonb(a)::text as dump
         from appointments a where id = $1`,
        [booked.appointment.id],
      );
      expect(row.rows[0]!.hash).toBe(sha256Hex(secret));
      expect(row.rows[0]!.dump).not.toContain(secret);

      const events = await db.query<{ dump: string }>(
        "select to_jsonb(e)::text as dump from appointment_events e where appointment_id = $1",
        [booked.appointment.id],
      );
      expect(events.rows.length).toBeGreaterThan(0);
      for (const event of events.rows) {
        expect(event.dump).not.toContain(secret);
      }
    });
  });

  it("zakazan termin se otvara brojem i tajnom, ne brojem i uređajem", async () => {
    // Uređaj je isti u svim salonima i čita ga svaki član salona iz istorije;
    // novi termin zato ne sme da se otvara njime.
    await withRollback(async (db) => {
      const salon = await bookingSalon(db);
      const phone = "+381645123482";
      const secret = newSecret();

      const booked = await book(db, salon, {
        phone,
        time: "10:15",
        secret,
        deviceId: "uredjaj-b",
      });
      expect(booked.ok).toBe(true);

      expect(
        (await upcoming(db, salon.slug, phone, [secret], "uredjaj-b"))!.length,
      ).toBe(1);
      expect(await upcoming(db, salon.slug, phone, [], "uredjaj-b")).toEqual([]);
    });
  });

  it("odbija tajnu pogrešnog oblika", async () => {
    await withRollback(async (db) => {
      const salon = await bookingSalon(db);

      for (const secret of ["kratka", `${newSecret()}x`, "+".repeat(43)]) {
        const result = await book(db, salon, {
          phone: "+381645123483",
          time: "10:30",
          secret,
        });
        expect(result).toEqual({ ok: false, reason: "invalid_proof" });
      }
    });
  });

  it("ponovljen zahtev sa istom tajnom vraća isti termin i ne pravi drugi", async () => {
    await withRollback(async (db) => {
      const salon = await bookingSalon(db);
      const secret = newSecret();
      const requestId = crypto.randomUUID();
      const input = {
        phone: "+381645123484",
        time: "10:45",
        secret,
        requestId,
      };

      const first = await book(db, salon, input);
      const second = await book(db, salon, input);

      expect(first.ok && second.ok).toBe(true);
      if (first.ok && second.ok) {
        expect(second.appointment.id).toBe(first.appointment.id);
        expect(second.replayed).toBe(true);
      }

      const count = await db.query<{ n: number }>(
        "select count(*)::int as n from appointments where tenant_id = $1",
        [salon.tenantId],
      );
      expect(count.rows[0]!.n).toBe(1);
    });
  });
});

describe("prelazna grana: termini zakazani pre tajne", () => {
  it("termin bez tajne otvaraju broj i uređaj sa kog je zakazan", async () => {
    await withRollback(async (db) => {
      const salon = await bookingSalon(db);
      const phone = "+381645123485";

      const booked = await book(db, salon, {
        phone,
        time: "11:00",
        deviceId: "uredjaj-c",
      });
      expect(booked.ok).toBe(true);
      if (!booked.ok) {
        return;
      }

      const list = await upcoming(db, salon.slug, phone, [], "uredjaj-c");
      expect(list!.map((row) => row.id)).toEqual([booked.appointment.id]);

      const result = await asAnon(db, () =>
        cancel(db, {
          slug: salon.slug,
          phone,
          appointmentId: booked.appointment.id,
          secrets: [],
          deviceId: "uredjaj-c",
        }),
      );
      expect(result.ok).toBe(true);
    });
  });

  it("drugi uređaj, prazan uređaj i izostanak uređaja ne otvaraju termin", async () => {
    await withRollback(async (db) => {
      const salon = await bookingSalon(db);
      const phone = "+381645123486";

      const booked = await book(db, salon, {
        phone,
        time: "11:15",
        deviceId: "uredjaj-d",
      });
      expect(booked.ok).toBe(true);

      for (const device of ["uredjaj-drugi", "", null]) {
        expect(await upcoming(db, salon.slug, phone, [], device)).toEqual([]);
      }
    });
  });

  it("uređaj bez pravog broja ne otvara termin", async () => {
    await withRollback(async (db) => {
      const salon = await bookingSalon(db);

      const booked = await book(db, salon, {
        phone: "+381645123487",
        time: "11:30",
        deviceId: "uredjaj-e",
      });
      expect(booked.ok).toBe(true);

      expect(
        await upcoming(db, salon.slug, "+381645123499", [], "uredjaj-e"),
      ).toEqual([]);
    });
  });

  it("termin koji je upisala vlasnica se ne otvara njenim uređajem", async () => {
    // Vlasnica i klijentkinja mogu da imaju isti uređaj u istoriji (vlasnica
    // zakazuje na telefonu sa kog je i sama klijentkinja); događaj sa akterom
    // `user` nije dokaz da je termin klijentkinjin.
    await withRollback(async (db) => {
      const salon = await bookingSalon(db);
      const phone = "+381645123488";
      const clientId = await createClient(db, salon.tenantId, phone);

      await db.query(
        `select set_config('app.actor_type', 'user', true),
                set_config('app.device_id', 'uredjaj-vlasnice', true)`,
      );
      const created = await insertAppointment(db, {
        tenantId: salon.tenantId,
        staffId: salon.staffId,
        serviceId: salon.serviceId,
        clientId,
        startAt: futureStartAt(),
      });
      // Čak i kad je izvor `public`, akter na događaju nastanka je vlasnica.
      await db.query("update appointments set source = 'public' where id = $1", [
        created.id,
      ]);
      await db.query(
        `select set_config('app.actor_type', '', true),
                set_config('app.device_id', '', true)`,
      );

      expect(
        await upcoming(db, salon.slug, phone, [], "uredjaj-vlasnice"),
      ).toEqual([]);
    });
  });

  it("termin koji je upisala vlasnica nema ni tajnu ni uređaj, pa se ne otkazuje preko sajta", async () => {
    await withRollback(async (db) => {
      const phone = "+381645552020";
      const tenantId = await createTenant(db);
      const staffId = await createStaff(db, tenantId);
      const serviceId = await createService(db, tenantId);
      const clientId = await createClient(db, tenantId, phone);
      const created = await insertAppointment(db, {
        tenantId,
        staffId,
        serviceId,
        clientId,
        startAt: futureStartAt(),
      });
      const slug = await slugOf(db, tenantId);

      const result = await asAnon(db, () =>
        cancel(db, {
          slug,
          phone,
          appointmentId: created.id,
          secrets: [newSecret()],
          deviceId: "bilo-koji",
        }),
      );

      expect(result).toEqual({ ok: false, reason: "not_found" });
    });
  });
});

describe("funkcije koje primaju samo broj telefona ne postoje", () => {
  it("stari oblici pretrage i otkazivanja su obrisani", async () => {
    await withRollback(async (db) => {
      const { rows } = await db.query<{ signature: string }>(
        `select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as signature
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname in ('public_appointments_for_phone', 'public_cancel_appointment')
         order by 1`,
      );

      expect(rows.map((row) => row.signature)).toEqual([
        "public_cancel_appointment(p_slug text, p_phone_e164 text, p_appointment_id uuid, p_secrets text[], p_device_id text, p_network_hash text)",
      ]);
    });
  });

  it("poziv starim oblikom (broj, termin, uređaj, mreža) po imenima parametara ne uspeva", async () => {
    // Tako zove PostgREST: bez `p_secrets` funkcija ne postoji, pa stari kod
    // za vreme puštanja dobija grešku umesto odgovora.
    await withRollback(async (db) => {
      const phone = "+381645552021";
      const base = await salonWithAppointment(db, phone);

      await asServer(db, async () => {
        await db.query("savepoint stari_poziv");
        await expect(
          db.query(
            `select public_cancel_appointment(
               p_slug => $1, p_phone_e164 => $2, p_appointment_id => $3,
               p_device_id => 'd', p_network_hash => 'h')`,
            [base.slug, phone, base.appointmentId],
          ),
        ).rejects.toThrow(/does not exist/);
        await db.query("rollback to savepoint stari_poziv");
      });

      const row = await db.query<{ status: string }>(
        "select status from appointments where id = $1",
        [base.appointmentId],
      );
      expect(row.rows[0]!.status).toBe("confirmed");
    });
  });
});

describe("heš tajne vide samo članovi svog salona", () => {
  it("član drugog salona ne čita manage_proof_hash", async () => {
    await withRollback(async (db) => {
      const base = await salonWithAppointment(db, "+381645552022");
      const otherTenantId = await createTenant(db);
      const otherUserId = await createUser(db, otherTenantId);

      const rows = await asUser(db, otherUserId, () =>
        db.query(
          "select manage_proof_hash from appointments where id = $1",
          [base.appointmentId],
        ),
      );
      expect(rows.rows).toEqual([]);
    });
  });

  it("neprijavljen ne čita termine", async () => {
    await withRollback(async (db) => {
      const base = await salonWithAppointment(db, "+381645552023");

      await asAnon(db, async () => {
        await db.query("savepoint anon_select");
        await expect(
          db.query("select manage_proof_hash from appointments where id = $1", [
            base.appointmentId,
          ]),
        ).rejects.toThrow(/permission denied/);
        await db.query("rollback to savepoint anon_select");
      });
    });
  });
});

describe("ograničenje samootkazivanja po broju telefona", () => {
  /** Još termina za isti salon i istog klijenta, svaki sledećeg dana. */
  async function extraAppointments(
    db: pg.PoolClient,
    base: Awaited<ReturnType<typeof salonWithAppointment>>,
    count: number,
  ): Promise<{ id: string; secret: string }[]> {
    const items = [{ id: base.appointmentId, secret: base.secret }];

    for (let index = 1; index < count; index += 1) {
      const startAt = new Date(
        new Date(futureStartAt()).getTime() + index * 24 * 60 * 60 * 1000,
      ).toISOString();
      const created = await insertAppointment(db, {
        tenantId: base.tenantId,
        staffId: base.staffId,
        serviceId: base.serviceId,
        clientId: base.clientId,
        startAt,
      });
      const secret = newSecret();
      await db.query(
        "update appointments set manage_proof_hash = $1 where id = $2",
        [sha256Hex(secret), created.id],
      );
      items.push({ id: created.id, secret });
    }

    return items;
  }

  it("četvrto otkazivanje istog broja u 24 sata odbija, termin ostaje aktivan", async () => {
    await withRollback(async (db) => {
      const phone = "+381645553001";
      const base = await salonWithAppointment(db, phone);
      const items = await extraAppointments(db, base, 4);

      for (const item of items.slice(0, 3)) {
        const result = await asAnon(db, () =>
          cancel(db, {
            slug: base.slug,
            phone,
            appointmentId: item.id,
            secrets: [item.secret],
          }),
        );
        expect(result.ok).toBe(true);
      }

      const fourth = items[3]!;
      const result = await asAnon(db, () =>
        cancel(db, {
          slug: base.slug,
          phone,
          appointmentId: fourth.id,
          secrets: [fourth.secret],
        }),
      );
      expect(result).toEqual({ ok: false, reason: "too_many_cancellations" });

      const row = await db.query<{ status: string }>(
        "select status from appointments where id = $1",
        [fourth.id],
      );
      expect(row.rows[0]!.status).toBe("confirmed");
    });
  });

  it("promena mreže ne zaobilazi brojač: ograničenje je po broju, ne po mreži", async () => {
    await withRollback(async (db) => {
      const phone = "+381645553002";
      const base = await salonWithAppointment(db, phone);
      const items = await extraAppointments(db, base, 4);

      for (const [index, item] of items.slice(0, 3).entries()) {
        await asAnon(db, () =>
          cancel(db, {
            slug: base.slug,
            phone,
            appointmentId: item.id,
            secrets: [item.secret],
            networkHash: `mreza-${index}`,
          }),
        );
      }

      const fourth = items[3]!;
      const result = await asAnon(db, () =>
        cancel(db, {
          slug: base.slug,
          phone,
          appointmentId: fourth.id,
          secrets: [fourth.secret],
          networkHash: "potpuno-nova-mreza",
        }),
      );

      expect(result).toEqual({ ok: false, reason: "too_many_cancellations" });
    });
  });

  it("ponovljen zahtev za već otkazan termin i dalje kaže „već otkazan“", async () => {
    await withRollback(async (db) => {
      const phone = "+381645553003";
      const base = await salonWithAppointment(db, phone);
      const items = await extraAppointments(db, base, 3);

      for (const item of items) {
        await asAnon(db, () =>
          cancel(db, {
            slug: base.slug,
            phone,
            appointmentId: item.id,
            secrets: [item.secret],
          }),
        );
      }

      const first = items[0]!;
      const replay = await asAnon(db, () =>
        cancel(db, {
          slug: base.slug,
          phone,
          appointmentId: first.id,
          secrets: [first.secret],
        }),
      );

      expect(replay).toEqual({ ok: false, reason: "already_cancelled" });
    });
  });

  it("drugi broj u istom salonu i isti broj u drugom salonu nisu pogođeni", async () => {
    await withRollback(async (db) => {
      const phone = "+381645553004";
      const base = await salonWithAppointment(db, phone);
      const items = await extraAppointments(db, base, 3);

      for (const item of items) {
        await asAnon(db, () =>
          cancel(db, {
            slug: base.slug,
            phone,
            appointmentId: item.id,
            secrets: [item.secret],
          }),
        );
      }

      const otherPhone = "+381645553005";
      const otherClient = await createClient(db, base.tenantId, otherPhone);
      const otherAppointment = await insertAppointment(db, {
        tenantId: base.tenantId,
        staffId: base.staffId,
        serviceId: base.serviceId,
        clientId: otherClient,
        startAt: new Date(
          new Date(futureStartAt()).getTime() + 10 * 24 * 60 * 60 * 1000,
        ).toISOString(),
      });
      const otherSecret = newSecret();
      await db.query(
        "update appointments set manage_proof_hash = $1 where id = $2",
        [sha256Hex(otherSecret), otherAppointment.id],
      );

      const otherNumber = await asAnon(db, () =>
        cancel(db, {
          slug: base.slug,
          phone: otherPhone,
          appointmentId: otherAppointment.id,
          secrets: [otherSecret],
        }),
      );
      expect(otherNumber.ok).toBe(true);

      const otherSalon = await salonWithAppointment(db, phone);
      const inOtherSalon = await asAnon(db, () =>
        cancel(db, {
          slug: otherSalon.slug,
          phone,
          appointmentId: otherSalon.appointmentId,
          secrets: [otherSalon.secret],
        }),
      );
      expect(inOtherSalon.ok).toBe(true);
    });
  });

  it("otkazivanja starija od 24 sata se ne računaju", async () => {
    await withRollback(async (db) => {
      const phone = "+381645553006";
      const base = await salonWithAppointment(db, phone);
      const items = await extraAppointments(db, base, 4);

      for (const item of items.slice(0, 3)) {
        await asAnon(db, () =>
          cancel(db, {
            slug: base.slug,
            phone,
            appointmentId: item.id,
            secrets: [item.secret],
          }),
        );
      }

      await db.query(
        `update appointment_events set created_at = now() - interval '25 hours'
         where tenant_id = $1 and to_status = 'cancelled_by_client'`,
        [base.tenantId],
      );

      const fourth = items[3]!;
      const result = await asAnon(db, () =>
        cancel(db, {
          slug: base.slug,
          phone,
          appointmentId: fourth.id,
          secrets: [fourth.secret],
        }),
      );
      expect(result.ok).toBe(true);
    });
  });

  it("otkazivanje koje je izvršila vlasnica ili salon se ne računa klijentkinji", async () => {
    await withRollback(async (db) => {
      const phone = "+381645553007";
      const base = await salonWithAppointment(db, phone);
      const items = await extraAppointments(db, base, 4);

      // Salon otkazuje direktno u bazi: akter je `system`, ne `client`.
      for (const item of items.slice(0, 3)) {
        await db.query(
          "update appointments set status = 'cancelled_by_salon' where id = $1",
          [item.id],
        );
      }

      const last = items[3]!;
      const result = await asAnon(db, () =>
        cancel(db, {
          slug: base.slug,
          phone,
          appointmentId: last.id,
          secrets: [last.secret],
        }),
      );
      expect(result.ok).toBe(true);
    });
  });

  it("izuzet broj (limit_exempt_phones) preskače brojač", async () => {
    await withRollback(async (db) => {
      const phone = "+381645553008";
      const base = await salonWithAppointment(db, phone);
      await db.query(
        "insert into limit_exempt_phones (tenant_id, phone_e164, note) values ($1, $2, 'test')",
        [base.tenantId, phone],
      );
      const items = await extraAppointments(db, base, 5);

      for (const item of items) {
        const result = await asAnon(db, () =>
          cancel(db, {
            slug: base.slug,
            phone,
            appointmentId: item.id,
            secrets: [item.secret],
          }),
        );
        expect(result.ok).toBe(true);
      }
    });
  });
});
