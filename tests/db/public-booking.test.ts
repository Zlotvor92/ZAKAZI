import type pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import {
  asAnon,
  closePool,
  createClient,
  createService,
  createStaff,
  createTenant,
  inSavepoint,
  insertAppointment,
  withRollback,
} from "./helpers";

afterAll(closePool);

type BookingData = {
  tenant: {
    name: string;
    slug: string;
    timezone: string;
    min_lead_minutes: number;
  };
  now: string;
  from_date: string;
  to_date: string;
  services: {
    id: string;
    name: string;
    duration_min: number;
    buffer_after_min: number;
    price_rsd: number;
  }[];
  working_hours: {
    weekday: number;
    start_minute: number;
    end_minute: number;
  }[];
  busy: { start_at: string; end_at: string }[];
};

type BookResult =
  | {
      ok: true;
      appointment: {
        id: string;
        start_at: string;
        end_at: string;
        service_name: string;
        price_rsd: number;
      };
    }
  | { ok: false; reason: string };

/**
 * Salon koji radi ponedeljkom 09–13, sa jednom uslugom od sat vremena.
 * Termini se traže za ponedeljak daleko u budućnosti da najraniji termin i
 * horizont ne bi sekli ono što test meri.
 */
async function openSalon(
  db: pg.PoolClient,
  options: {
    durationMin?: number;
    bufferAfterMin?: number;
    horizonDays?: number;
    minLeadMinutes?: number;
    enabled?: boolean;
    linkService?: boolean;
  } = {},
) {
  const tenantId = await createTenant(db);
  const staffId = await createStaff(db, tenantId);
  const serviceId = await createService(db, tenantId, {
    durationMin: options.durationMin ?? 60,
    bufferAfterMin: options.bufferAfterMin ?? 0,
  });

  if (options.linkService !== false) {
    await db.query(
      "insert into staff_services (tenant_id, staff_id, service_id) values ($1, $2, $3)",
      [tenantId, staffId, serviceId],
    );
  }

  await db.query(
    `insert into working_hours (tenant_id, staff_id, weekday, start_time, end_time)
     values ($1, $2, 1, '09:00', '13:00')`,
    [tenantId, staffId],
  );

  await db.query(
    `update tenants
        set booking_horizon_days = $2,
            min_lead_minutes = $3,
            public_booking_enabled = $4
      where id = $1`,
    [
      tenantId,
      options.horizonDays ?? 90,
      options.minLeadMinutes ?? 0,
      options.enabled ?? true,
    ],
  );

  const slug = await db.query<{ slug: string }>(
    "select slug from tenants where id = $1",
    [tenantId],
  );

  return {
    tenantId,
    staffId,
    serviceId,
    slug: slug.rows[0]!.slug,
  };
}

/** Prvi ponedeljak koji je bar nedelju dana ispred današnjeg dana. */
async function nextMonday(db: pg.PoolClient, atTime = "09:00"): Promise<string> {
  const result = await db.query<{ at: string }>(
    `select to_char(
              (date_trunc('week', (now() at time zone 'Europe/Belgrade')::date + 14)::date
               + $1::time) at time zone 'Europe/Belgrade',
              'YYYY-MM-DD"T"HH24:MI:SSOF'
            ) as at`,
    [atTime],
  );
  return result.rows[0]!.at;
}

/** Vreme po Beogradu, pomereno za dati broj dana od danas. */
async function atLocalTime(
  db: pg.PoolClient,
  dayOffset: number,
  atTime: string,
): Promise<string> {
  const result = await db.query<{ at: string }>(
    `select to_char(
              (((now() at time zone 'Europe/Belgrade')::date + $1::int) + $2::time)
                at time zone 'Europe/Belgrade',
              'YYYY-MM-DD"T"HH24:MI:SSOF'
            ) as at`,
    [dayOffset, atTime],
  );
  return result.rows[0]!.at;
}

async function bookingData(
  db: pg.PoolClient,
  slug: string,
): Promise<BookingData | null> {
  const result = await db.query<{ data: BookingData | null }>(
    "select public_booking_data($1) as data",
    [slug],
  );
  return result.rows[0]!.data;
}

async function book(
  db: pg.PoolClient,
  input: {
    slug: string;
    serviceId: string;
    startAt: string;
    name?: string;
    phone?: string;
    deviceId?: string;
  },
): Promise<BookResult> {
  const result = await db.query<{ result: BookResult }>(
    "select public_book($1, $2, $3, $4, $5, $6) as result",
    [
      input.slug,
      input.serviceId,
      input.startAt,
      input.name ?? "Jelena",
      input.phone ?? "+381641234567",
      input.deviceId ?? null,
    ],
  );
  return result.rows[0]!.result;
}

describe("neulogovan posetilac nema pristup tabelama", () => {
  it("ne čita klijente, termine, salone ni usluge", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);
      await createClient(db, salon.tenantId, "+381649999999");

      const counts = await asAnon(db, async () => {
        const rows: Record<string, number> = {};
        for (const table of [
          "tenants",
          "clients",
          "appointments",
          "services",
          "working_hours",
          "staff",
          "appointment_events",
        ]) {
          const result = await db.query<{ count: string }>(
            `select count(*)::int as count from ${table}`,
          );
          rows[table] = Number(result.rows[0]!.count);
        }
        return rows;
      });

      expect(Object.values(counts).every((count) => count === 0)).toBe(true);
    });
  });

  it("ne može sam da upiše termin ni klijenta", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);
      const clientId = await createClient(db, salon.tenantId);

      await asAnon(db, async () => {
        const inserted = await db.query(
          `insert into clients (tenant_id, name, phone_e164)
           select $1, 'Uljez', '+381640000001'
           where false`,
          [salon.tenantId],
        );
        expect(inserted.rowCount).toBe(0);

        await expect(
          inSavepoint(db, () =>
            db.query(
              `insert into clients (tenant_id, name, phone_e164)
               values ($1, 'Uljez', '+381640000002')`,
              [salon.tenantId],
            ),
          ),
        ).rejects.toThrow(/row-level security/i);

        await expect(
          inSavepoint(db, () =>
            insertAppointment(db, {
              tenantId: salon.tenantId,
              staffId: salon.staffId,
              serviceId: salon.serviceId,
              clientId,
              startAt: "2026-09-14T08:00:00Z",
            }),
          ),
        ).rejects.toThrow(/row-level security/i);
      });
    });
  });

  it("ne može da pozove pomoćnu funkciju za izbor izvođača", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);

      await asAnon(db, async () => {
        await expect(
          inSavepoint(db, () =>
            db.query("select booking_staff_id($1)", [salon.tenantId]),
          ),
        ).rejects.toThrow(/permission denied/i);
      });
    });
  });
});

describe("public_booking_data", () => {
  it("neulogovan posetilac dobija sve što mu treba", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);

      const data = await asAnon(db, async () => bookingData(db, salon.slug));

      expect(data!.tenant.timezone).toBe("Europe/Belgrade");
      expect(data!.services).toHaveLength(1);
      expect(data!.services[0]).toMatchObject({
        duration_min: 60,
        buffer_after_min: 0,
      });
      expect(data!.working_hours).toEqual([
        { weekday: 1, start_minute: 540, end_minute: 780 },
      ]);
    });
  });

  it("raspon dana određuje baza, a ne pozivalac", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db, { horizonDays: 7 });

      const data = await asAnon(db, async () => bookingData(db, salon.slug));

      const from = new Date(`${data!.from_date}T00:00:00Z`);
      const to = new Date(`${data!.to_date}T00:00:00Z`);
      const days = (to.getTime() - from.getTime()) / 86_400_000;

      expect(days).toBe(7);
    });
  });

  it("zauzeto vreme izlazi bez ijednog podatka o klijentu", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db, { bufferAfterMin: 15 });
      const clientId = await createClient(db, salon.tenantId, "+381641111111");
      const startAt = await nextMonday(db, "10:00");

      await insertAppointment(db, {
        tenantId: salon.tenantId,
        staffId: salon.staffId,
        serviceId: salon.serviceId,
        clientId,
        startAt,
        durationMin: 60,
        bufferAfterMin: 15,
      });

      const data = await asAnon(db, async () => bookingData(db, salon.slug));

      expect(data!.busy).toHaveLength(1);
      expect(Object.keys(data!.busy[0]!).sort()).toEqual(["end_at", "start_at"]);

      // Zauzeto je usluga plus bafer, ne samo usluga.
      const busyMinutes =
        (new Date(data!.busy[0]!.end_at).getTime() -
          new Date(data!.busy[0]!.start_at).getTime()) /
        60_000;
      expect(busyMinutes).toBe(75);
    });
  });

  it("odsustvo izlazi kao zauzeto vreme", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);
      const startAt = await nextMonday(db, "09:00");
      const endAt = await nextMonday(db, "13:00");

      await db.query(
        `insert into time_off (tenant_id, staff_id, start_at, end_at, reason)
         values ($1, $2, $3, $4, 'lekar')`,
        [salon.tenantId, salon.staffId, startAt, endAt],
      );

      const data = await asAnon(db, async () => bookingData(db, salon.slug));

      expect(data!.busy).toHaveLength(1);
    });
  });

  it("otkazan termin ne drži vreme", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);
      const clientId = await createClient(db, salon.tenantId, "+381642222222");
      const startAt = await nextMonday(db, "10:00");

      await insertAppointment(db, {
        tenantId: salon.tenantId,
        staffId: salon.staffId,
        serviceId: salon.serviceId,
        clientId,
        startAt,
        status: "cancelled_by_client",
      });

      const data = await asAnon(db, async () => bookingData(db, salon.slug));

      expect(data!.busy).toEqual([]);
    });
  });

  it("tuđi salon ne curi ni u jedan spisak", async () => {
    await withRollback(async (db) => {
      const mine = await openSalon(db);
      const theirs = await openSalon(db);
      const clientId = await createClient(db, theirs.tenantId, "+381643333333");

      await insertAppointment(db, {
        tenantId: theirs.tenantId,
        staffId: theirs.staffId,
        serviceId: theirs.serviceId,
        clientId,
        startAt: await nextMonday(db, "10:00"),
      });

      const data = await asAnon(db, async () => bookingData(db, mine.slug));

      expect(data!.services.map((service) => service.id)).not.toContain(
        theirs.serviceId,
      );
      expect(data!.busy).toEqual([]);
    });
  });

  it("ugašeno zakazivanje ne vraća ništa", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db, { enabled: false });

      expect(await asAnon(db, async () => bookingData(db, salon.slug))).toBeNull();
    });
  });

  it("nepoznat salon ne vraća ništa", async () => {
    await withRollback(async (db) => {
      expect(await asAnon(db, async () => bookingData(db, "nema-ovoga"))).toBeNull();
    });
  });

  it("usluga koju izvođač ne radi se ne nudi", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db, { linkService: false });

      const data = await asAnon(db, async () => bookingData(db, salon.slug));

      expect(data!.services).toEqual([]);
    });
  });
});

describe("public_book upisuje termin", () => {
  it("neulogovan posetilac zakaže i termin je odmah potvrđen", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);
      const startAt = await nextMonday(db, "10:00");

      const result = await asAnon(db, async () =>
        book(db, { slug: salon.slug, serviceId: salon.serviceId, startAt }),
      );

      expect(result.ok).toBe(true);

      const row = await db.query<{ status: string; source: string; confirmed_at: Date }>(
        "select status, source, confirmed_at from appointments where tenant_id = $1",
        [salon.tenantId],
      );

      expect(row.rows[0]).toMatchObject({ status: "confirmed", source: "public" });
      expect(row.rows[0]!.confirmed_at).not.toBeNull();
    });
  });

  it("upisuje klijenta i vezuje ga za termin", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);
      const startAt = await nextMonday(db, "10:00");

      await asAnon(db, async () =>
        book(db, {
          slug: salon.slug,
          serviceId: salon.serviceId,
          startAt,
          name: "  Milica Jović  ",
          phone: "+381645550001",
        }),
      );

      const row = await db.query<{ name: string; phone_e164: string }>(
        `select c.name, c.phone_e164
         from clients c join appointments a on a.client_id = c.id
         where a.tenant_id = $1`,
        [salon.tenantId],
      );

      expect(row.rows[0]).toEqual({
        name: "Milica Jović",
        phone_e164: "+381645550001",
      });
    });
  });

  it("trajanje i cena se prepisuju sa usluge", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db, { durationMin: 90, bufferAfterMin: 15 });
      const startAt = await nextMonday(db, "09:00");

      await asAnon(db, async () =>
        book(db, { slug: salon.slug, serviceId: salon.serviceId, startAt }),
      );

      const row = await db.query<{
        duration_min: number;
        buffer_after_min: number;
        price_rsd: number;
      }>(
        `select duration_min, buffer_after_min, price_rsd
         from appointments where tenant_id = $1`,
        [salon.tenantId],
      );

      expect(row.rows[0]).toEqual({
        duration_min: 90,
        buffer_after_min: 15,
        price_rsd: 2500,
      });
    });
  });

  it("ostavlja trag u istoriji sa akterom klijent", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);
      const startAt = await nextMonday(db, "10:00");

      await asAnon(db, async () =>
        book(db, {
          slug: salon.slug,
          serviceId: salon.serviceId,
          startAt,
          deviceId: "iphone-14",
        }),
      );

      const events = await db.query<{
        from_status: string | null;
        to_status: string;
        actor_type: string;
        device_id: string | null;
      }>(
        `select from_status, to_status, actor_type, device_id
         from appointment_events where tenant_id = $1`,
        [salon.tenantId],
      );

      expect(events.rows).toEqual([
        {
          from_status: null,
          to_status: "confirmed",
          actor_type: "client",
          device_id: "iphone-14",
        },
      ]);
    });
  });

  it("isti broj drugi put ne pravi novog klijenta i ne menja mu ime", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);

      await asAnon(db, async () =>
        book(db, {
          slug: salon.slug,
          serviceId: salon.serviceId,
          startAt: await nextMonday(db, "09:00"),
          name: "Jelena Petrović",
          phone: "+381645550002",
        }),
      );
      await asAnon(db, async () =>
        book(db, {
          slug: salon.slug,
          serviceId: salon.serviceId,
          startAt: await nextMonday(db, "11:00"),
          name: "jeca",
          phone: "+381645550002",
        }),
      );

      const clients = await db.query<{ name: string }>(
        "select name from clients where tenant_id = $1",
        [salon.tenantId],
      );

      expect(clients.rows).toEqual([{ name: "Jelena Petrović" }]);
    });
  });
});

describe("public_book odbija ono što ne sme", () => {
  it("zauzet termin", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);
      const startAt = await nextMonday(db, "10:00");

      const first = await asAnon(db, async () =>
        book(db, { slug: salon.slug, serviceId: salon.serviceId, startAt }),
      );
      const second = await asAnon(db, async () =>
        book(db, {
          slug: salon.slug,
          serviceId: salon.serviceId,
          startAt,
          phone: "+381645550003",
        }),
      );

      expect(first.ok).toBe(true);
      expect(second).toEqual({ ok: false, reason: "slot_taken" });
    });
  });

  it("termin koji bafer prethodnog gura u zauzeto", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db, { durationMin: 60, bufferAfterMin: 15 });

      await asAnon(db, async () =>
        book(db, {
          slug: salon.slug,
          serviceId: salon.serviceId,
          startAt: await nextMonday(db, "09:00"),
        }),
      );

      // Prethodni drži 09:00–10:15. Termin u 10:00 mora pasti.
      const result = await asAnon(db, async () =>
        book(db, {
          slug: salon.slug,
          serviceId: salon.serviceId,
          startAt: await nextMonday(db, "10:00"),
          phone: "+381645550004",
        }),
      );

      expect(result).toEqual({ ok: false, reason: "slot_taken" });
    });
  });

  it("termin van radnog vremena", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);

      const result = await asAnon(db, async () =>
        book(db, {
          slug: salon.slug,
          serviceId: salon.serviceId,
          startAt: await nextMonday(db, "20:00"),
        }),
      );

      expect(result).toEqual({ ok: false, reason: "outside_working_hours" });
    });
  });

  it("termin čija usluga ne stane do zatvaranja", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db, { durationMin: 60 });

      const result = await asAnon(db, async () =>
        book(db, {
          slug: salon.slug,
          serviceId: salon.serviceId,
          startAt: await nextMonday(db, "12:30"),
        }),
      );

      expect(result).toEqual({ ok: false, reason: "outside_working_hours" });
    });
  });

  it("termin van mreže od petnaest minuta", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);

      const result = await asAnon(db, async () =>
        book(db, {
          slug: salon.slug,
          serviceId: salon.serviceId,
          startAt: await nextMonday(db, "10:07"),
        }),
      );

      expect(result).toEqual({ ok: false, reason: "off_grid" });
    });
  });

  it("termin u danu odsustva", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);

      await db.query(
        `insert into time_off (tenant_id, staff_id, start_at, end_at, reason)
         values ($1, $2, $3, $4, 'lekar')`,
        [
          salon.tenantId,
          salon.staffId,
          await nextMonday(db, "09:00"),
          await nextMonday(db, "13:00"),
        ],
      );

      const result = await asAnon(db, async () =>
        book(db, {
          slug: salon.slug,
          serviceId: salon.serviceId,
          startAt: await nextMonday(db, "10:00"),
        }),
      );

      expect(result).toEqual({ ok: false, reason: "time_off" });
    });
  });

  it("termin ranije nego što salon prima", async () => {
    await withRollback(async (db) => {
      // Salon prima najranije nedelju dana unapred; sutra je prerano.
      const salon = await openSalon(db, { minLeadMinutes: 10080 });
      const tomorrow = await atLocalTime(db, 1, "10:00");

      const result = await asAnon(db, async () =>
        book(db, {
          slug: salon.slug,
          serviceId: salon.serviceId,
          startAt: tomorrow,
        }),
      );

      expect(result).toEqual({ ok: false, reason: "too_soon" });
    });
  });

  it("termin dalji od horizonta", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db, { horizonDays: 1 });

      const result = await asAnon(db, async () =>
        book(db, {
          slug: salon.slug,
          serviceId: salon.serviceId,
          startAt: await nextMonday(db, "10:00"),
        }),
      );

      expect(result).toEqual({ ok: false, reason: "outside_window" });
    });
  });

  it("treći termin na isti broj telefona", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);
      const phone = "+381645550005";

      for (const time of ["09:00", "10:00"]) {
        const result = await asAnon(db, async () =>
          book(db, {
            slug: salon.slug,
            serviceId: salon.serviceId,
            startAt: await nextMonday(db, time),
            phone,
          }),
        );
        expect(result.ok).toBe(true);
      }

      const third = await asAnon(db, async () =>
        book(db, {
          slug: salon.slug,
          serviceId: salon.serviceId,
          startAt: await nextMonday(db, "11:00"),
          phone,
        }),
      );

      expect(third).toEqual({ ok: false, reason: "too_many_bookings" });
    });
  });

  it("usluga iz tuđeg salona", async () => {
    await withRollback(async (db) => {
      const mine = await openSalon(db);
      const theirs = await openSalon(db);

      const result = await asAnon(db, async () =>
        book(db, {
          slug: mine.slug,
          serviceId: theirs.serviceId,
          startAt: await nextMonday(db, "10:00"),
        }),
      );

      expect(result).toEqual({ ok: false, reason: "unknown_service" });
    });
  });

  it("ugašeno javno zakazivanje", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db, { enabled: false });

      const result = await asAnon(db, async () =>
        book(db, {
          slug: salon.slug,
          serviceId: salon.serviceId,
          startAt: await nextMonday(db, "10:00"),
        }),
      );

      expect(result).toEqual({ ok: false, reason: "booking_closed" });
    });
  });

  it("prazno ime i ime preko osamdeset znakova", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);
      const startAt = await nextMonday(db, "10:00");

      for (const name of ["", "   ", "a".repeat(81)]) {
        const result = await asAnon(db, async () =>
          book(db, {
            slug: salon.slug,
            serviceId: salon.serviceId,
            startAt,
            name,
          }),
        );
        expect(result).toEqual({ ok: false, reason: "invalid_name" });
      }
    });
  });

  it("broj telefona koji nije u E.164 obliku", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);
      const startAt = await nextMonday(db, "10:00");

      for (const phone of ["0641234567", "+0641234567", "telefon", ""]) {
        const result = await asAnon(db, async () =>
          book(db, {
            slug: salon.slug,
            serviceId: salon.serviceId,
            startAt,
            phone,
          }),
        );
        expect(result).toEqual({ ok: false, reason: "invalid_phone" });
      }
    });
  });

  it("odbijen pokušaj ne ostavlja ni klijenta ni termin", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);

      await asAnon(db, async () =>
        book(db, {
          slug: salon.slug,
          serviceId: salon.serviceId,
          startAt: await nextMonday(db, "20:00"),
          phone: "+381645550006",
        }),
      );

      const clients = await db.query(
        "select 1 from clients where tenant_id = $1",
        [salon.tenantId],
      );
      const appointments = await db.query(
        "select 1 from appointments where tenant_id = $1",
        [salon.tenantId],
      );

      expect(clients.rowCount).toBe(0);
      expect(appointments.rowCount).toBe(0);
    });
  });
});
