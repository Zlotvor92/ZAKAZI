import type pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import {
  bookingDataSchema,
  bookResultSchema,
} from "@/lib/db/public-booking";
import {
  asAnon,
  asUser,
  closePool,
  createClient,
  createService,
  createStaff,
  createTenant,
  createUser,
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
  services: { id: string; name: string; price_rsd: number }[];
  blocks: {
    weekday: number;
    start_minute: number;
    end_minute: number;
    slot_minutes: number;
  }[];
  busy: { start_at: string; end_at: string }[];
};

type BookResult =
  | {
      ok: true;
      appointment: {
        id: string;
        tenant_id: string;
        timezone: string;
        start_at: string;
        end_at: string;
        service_name: string;
        price_rsd: number;
      };
    }
  | { ok: false; reason: string };

/**
 * Salon koji radi ponedeljkom 09–18 sa terminom od sat i po, pa slobodni
 * termini padaju na 09:00, 10:30, 12:00, 13:30, 15:00 i 16:30. Traže se za
 * ponedeljak daleko u budućnosti da najraniji termin i horizont ne bi sekli
 * ono što test meri.
 */
async function openSalon(
  db: pg.PoolClient,
  options: {
    slotMinutes?: number;
    serviceMinutes?: number;
    horizonDays?: number;
    minLeadMinutes?: number;
    enabled?: boolean;
    linkService?: boolean;
  } = {},
) {
  const tenantId = await createTenant(db);
  const staffId = await createStaff(db, tenantId);
  const serviceId = await createService(db, tenantId, options.serviceMinutes ?? 90);

  if (options.linkService !== false) {
    await db.query(
      "insert into staff_services (tenant_id, staff_id, service_id) values ($1, $2, $3)",
      [tenantId, staffId, serviceId],
    );
  }

  await db.query(
    `insert into working_hours
       (tenant_id, staff_id, weekday, start_time, end_time, slot_minutes)
     values ($1, $2, 1, '09:00', '18:00', $3)`,
    [tenantId, staffId, options.slotMinutes ?? 90],
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

/**
 * Ponedeljak bar dve nedelje ispred današnjeg dana, uz mogućnost da se pomeri
 * za dati broj nedelja unapred.
 */
async function nextMonday(
  db: pg.PoolClient,
  atTime = "09:00",
  weeksAhead = 0,
): Promise<string> {
  const result = await db.query<{ at: string }>(
    `select to_char(
              (date_trunc(
                 'week',
                 (now() at time zone 'Europe/Belgrade')::date + 14 + $2::int * 7
               )::date + $1::time) at time zone 'Europe/Belgrade',
              'YYYY-MM-DD"T"HH24:MI:SSOF'
            ) as at`,
    [atTime, weeksAhead],
  );
  return result.rows[0]!.at;
}

/** Termin upisan mimo javne funkcije, ali kao da je došao sa datog uređaja. */
async function insertAsDevice(
  db: pg.PoolClient,
  deviceId: string,
  input: Parameters<typeof insertAppointment>[1],
): Promise<void> {
  await db.query("select set_config('app.device_id', $1, true)", [deviceId]);
  try {
    await insertAppointment(db, input);
  } finally {
    await db.query("select set_config('app.device_id', '', true)");
  }
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
    networkHash?: string;
  },
): Promise<BookResult> {
  const result = await db.query<{ result: BookResult }>(
    "select public_book($1, $2, $3, $4, $5, $6, $7) as result",
    [
      input.slug,
      input.serviceId,
      input.startAt,
      input.name ?? "Jelena",
      input.phone ?? "+381645123480",
      input.deviceId ?? null,
      input.networkHash ?? null,
    ],
  );
  return result.rows[0]!.result;
}

describe("neulogovan posetilac nema pristup tabelama", () => {
  it("ne čita klijente, termine, salone ni usluge", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);
      await createClient(db, salon.tenantId, "+381649999999");

      await asAnon(db, async () => {
        for (const table of [
          "tenants",
          "clients",
          "appointments",
          "services",
          "working_hours",
          "staff",
          "appointment_events",
        ]) {
          await expect(
            inSavepoint(db, () =>
              db.query(`select count(*) from ${table}`),
            ),
            `${table} je dostupan neulogovanom posetiocu`,
          ).rejects.toThrow(/permission denied/i);
        }
      });
    });
  });

  it("ne može sam da upiše termin ni klijenta", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);
      const clientId = await createClient(db, salon.tenantId);

      // Termin nastaje isključivo kroz `public_book`, koja proverava radno
      // vreme, ograničenja i blokade. Direktan upis bi zaobišao sve to, pa
      // neprijavljeni do tabela ne dolazi uopšte.
      await asAnon(db, async () => {
        await expect(
          inSavepoint(db, () =>
            db.query(
              `insert into clients (tenant_id, name, phone_e164)
               values ($1, 'Uljez', '+381640000001')`,
              [salon.tenantId],
            ),
          ),
        ).rejects.toThrow(/permission denied/i);

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
        ).rejects.toThrow(/permission denied/i);
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
      expect(data!.services[0]).toMatchObject({ name: "Gel nokti" });
      expect(data!.blocks).toEqual([
        {
          weekday: 1,
          start_minute: 540,
          end_minute: 1080,
          slot_minutes: 90,
        },
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
      const salon = await openSalon(db);
      const clientId = await createClient(db, salon.tenantId, "+381641111111");
      const startAt = await nextMonday(db, "10:30");

      await insertAppointment(db, {
        tenantId: salon.tenantId,
        staffId: salon.staffId,
        serviceId: salon.serviceId,
        clientId,
        startAt,
        durationMin: 90,
      });

      const data = await asAnon(db, async () => bookingData(db, salon.slug));

      expect(data!.busy).toHaveLength(1);
      expect(Object.keys(data!.busy[0]!).sort()).toEqual(["end_at", "start_at"]);

      // Zauzeto traje tačno koliko i termin.
      const busyMinutes =
        (new Date(data!.busy[0]!.end_at).getTime() -
          new Date(data!.busy[0]!.start_at).getTime()) /
        60_000;
      expect(busyMinutes).toBe(90);
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
      const startAt = await nextMonday(db, "10:30");

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
        startAt: await nextMonday(db, "10:30"),
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

describe("oblik odgovora se poklapa sa onim što aplikacija očekuje", () => {
  it("public_booking_data prolazi kroz Zod šemu netaknut", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);
      const clientId = await createClient(db, salon.tenantId, "+381644444444");

      await insertAppointment(db, {
        tenantId: salon.tenantId,
        staffId: salon.staffId,
        serviceId: salon.serviceId,
        clientId,
        startAt: await nextMonday(db, "10:30"),
      });

      const data = await asAnon(db, async () => bookingData(db, salon.slug));

      expect(() => bookingDataSchema.parse(data)).not.toThrow();
    });
  });

  it("public_book prolazi kroz Zod šemu i kad uspe i kad odbije", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);
      const startAt = await nextMonday(db, "10:30");

      const accepted = await asAnon(db, async () =>
        book(db, { slug: salon.slug, serviceId: salon.serviceId, startAt }),
      );
      const rejected = await asAnon(db, async () =>
        book(db, {
          slug: salon.slug,
          serviceId: salon.serviceId,
          startAt,
          phone: "+381649990000",
        }),
      );

      expect(() => bookResultSchema.parse(accepted)).not.toThrow();
      expect(() => bookResultSchema.parse(rejected)).not.toThrow();
    });
  });
});

describe("public_book upisuje termin", () => {
  it("neulogovan posetilac zakaže i termin je odmah potvrđen", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);
      const startAt = await nextMonday(db, "10:30");

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
      const startAt = await nextMonday(db, "10:30");

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

  it("trajanje dolazi sa usluge, ne sa razmaka u rasporedu", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db, { serviceMinutes: 120 });
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
        duration_min: 120,
        buffer_after_min: 0,
        price_rsd: 2500,
      });
    });
  });

  it("ostavlja trag u istoriji sa akterom klijent", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);
      const startAt = await nextMonday(db, "10:30");

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
          startAt: await nextMonday(db, "12:00"),
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
      const startAt = await nextMonday(db, "10:30");

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

  it("sledeći termin počinje tačno kad se prethodni završi", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);

      await asAnon(db, async () =>
        book(db, {
          slug: salon.slug,
          serviceId: salon.serviceId,
          startAt: await nextMonday(db, "09:00"),
        }),
      );

      // Prethodni drži 09:00–10:30, pa 10:30 mora da prođe.
      const result = await asAnon(db, async () =>
        book(db, {
          slug: salon.slug,
          serviceId: salon.serviceId,
          startAt: await nextMonday(db, "10:30"),
          phone: "+381645550004",
        }),
      );

      expect(result.ok).toBe(true);
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

  it("vreme koje nije početak nijednog termina", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);

      // 10:07 pada usred radnog vremena ali nije početak nijednog termina.
      for (const at of ["10:07", "12:30"]) {
        const result = await asAnon(db, async () =>
          book(db, {
            slug: salon.slug,
            serviceId: salon.serviceId,
            startAt: await nextMonday(db, at),
          }),
        );

        expect(result).toEqual({ ok: false, reason: "outside_working_hours" });
      }
    });
  });

  it("posle kraja bloka se ne može ni početi", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);

      const result = await asAnon(db, async () =>
        book(db, {
          slug: salon.slug,
          serviceId: salon.serviceId,
          startAt: await nextMonday(db, "18:00"),
        }),
      );

      expect(result).toEqual({ ok: false, reason: "outside_working_hours" });
    });
  });

  it("poslednji termin sme da se prelije preko kraja bloka", async () => {
    await withRollback(async (db) => {
      // Blok do 18:00, dolazak u 16:30, usluga od dva sata: završava u 18:30.
      const salon = await openSalon(db, { serviceMinutes: 120 });

      const result = await asAnon(db, async () =>
        book(db, {
          slug: salon.slug,
          serviceId: salon.serviceId,
          startAt: await nextMonday(db, "16:30"),
        }),
      );

      expect(result.ok).toBe(true);
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
          startAt: await nextMonday(db, "10:30"),
        }),
      );

      expect(result).toEqual({ ok: false, reason: "time_off" });
    });
  });

  it("termin ranije nego što salon prima", async () => {
    await withRollback(async (db) => {
      // Salon prima najranije nedelju dana unapred; sutra je prerano.
      const salon = await openSalon(db, { minLeadMinutes: 10080 });
      const tomorrow = await atLocalTime(db, 1, "10:30");

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
          startAt: await nextMonday(db, "10:30"),
        }),
      );

      expect(result).toEqual({ ok: false, reason: "outside_window" });
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
          startAt: await nextMonday(db, "10:30"),
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
          startAt: await nextMonday(db, "10:30"),
        }),
      );

      expect(result).toEqual({ ok: false, reason: "booking_closed" });
    });
  });

  it("prazno ime i ime preko osamdeset znakova", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);
      const startAt = await nextMonday(db, "10:30");

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
      const startAt = await nextMonday(db, "10:30");

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

describe("zaštita od lažnih zakazivanja", () => {
  it("treći termin u istoj nedelji na isti broj pada", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);
      const phone = "+381645550005";

      for (const time of ["09:00", "10:30"]) {
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
          startAt: await nextMonday(db, "12:00"),
          phone,
        }),
      );

      expect(third).toEqual({ ok: false, reason: "too_many_this_week" });
    });
  });

  it("ko dolazi svake nedelje ne udara u limit", async () => {
    // Ovo je najskuplja moguća greška u ovom delu: stalna mušterija koja
    // zakazuje mesec dana unapred ne sme da dobije odbijenicu.
    await withRollback(async (db) => {
      const salon = await openSalon(db);
      const phone = "+381645550007";

      for (const week of [0, 1, 2, 3]) {
        const result = await asAnon(db, async () =>
          book(db, {
            slug: salon.slug,
            serviceId: salon.serviceId,
            startAt: await nextMonday(db, "10:30", week),
            phone,
          }),
        );
        expect(result.ok).toBe(true);
      }
    });
  });

  it("dva termina razmaknuta tačno sedam dana su dozvoljena", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);
      const phone = "+381645550008";

      const first = await asAnon(db, async () =>
        book(db, {
          slug: salon.slug,
          serviceId: salon.serviceId,
          startAt: await nextMonday(db, "10:30", 0),
          phone,
        }),
      );
      const second = await asAnon(db, async () =>
        book(db, {
          slug: salon.slug,
          serviceId: salon.serviceId,
          startAt: await nextMonday(db, "10:30", 1),
          phone,
        }),
      );

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
    });
  });

  it("nepoznat broj ne može da razmaže više od četiri termina", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);
      const phone = "+381645550009";
      const clientId = await createClient(db, salon.tenantId, phone);

      // Četiri termina razmaknuta po dve nedelje: nedeljni limit ih pušta.
      for (const week of [0, 2, 4, 6]) {
        await insertAppointment(db, {
          tenantId: salon.tenantId,
          staffId: salon.staffId,
          serviceId: salon.serviceId,
          clientId,
          startAt: await nextMonday(db, "10:30", week),
        });
      }

      const fifth = await asAnon(db, async () =>
        book(db, {
          slug: salon.slug,
          serviceId: salon.serviceId,
          startAt: await nextMonday(db, "10:30", 8),
          phone,
        }),
      );

      expect(fifth).toEqual({ ok: false, reason: "too_many_upcoming" });
    });
  });

  it("ko je već dolazio sme više od nepoznatog broja", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);
      const phone = "+381645550010";
      const clientId = await createClient(db, salon.tenantId, phone);

      // Jedan termin na kom je stvarno bila, u prošlosti.
      await insertAppointment(db, {
        tenantId: salon.tenantId,
        staffId: salon.staffId,
        serviceId: salon.serviceId,
        clientId,
        startAt: "2020-06-01T08:00:00Z",
        status: "completed",
      });

      for (const week of [0, 2, 4, 6]) {
        await insertAppointment(db, {
          tenantId: salon.tenantId,
          staffId: salon.staffId,
          serviceId: salon.serviceId,
          clientId,
          startAt: await nextMonday(db, "10:30", week),
        });
      }

      const fifth = await asAnon(db, async () =>
        book(db, {
          slug: salon.slug,
          serviceId: salon.serviceId,
          startAt: await nextMonday(db, "10:30", 8),
          phone,
        }),
      );

      expect(fifth.ok).toBe(true);
    });
  });

  it("otkazan termin ne troši limit", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);
      const phone = "+381645550011";
      const clientId = await createClient(db, salon.tenantId, phone);

      for (const time of ["09:00", "10:30"]) {
        await insertAppointment(db, {
          tenantId: salon.tenantId,
          staffId: salon.staffId,
          serviceId: salon.serviceId,
          clientId,
          startAt: await nextMonday(db, time),
          status: "cancelled_by_client",
        });
      }

      const result = await asAnon(db, async () =>
        book(db, {
          slug: salon.slug,
          serviceId: salon.serviceId,
          startAt: await nextMonday(db, "12:00"),
          phone,
        }),
      );

      expect(result.ok).toBe(true);
    });
  });

  it("isti uređaj sa raznim brojevima udara u svoj limit", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);
      const device = "isti-telefon";

      // Šest termina sa šest različitih brojeva, svi sa istog uređaja.
      for (const week of [0, 1, 2, 3, 4, 5]) {
        const phone = `+38164777000${week}`;
        const clientId = await createClient(db, salon.tenantId, phone);
        await insertAsDevice(db, device, {
          tenantId: salon.tenantId,
          staffId: salon.staffId,
          serviceId: salon.serviceId,
          clientId,
          startAt: await nextMonday(db, "10:30", week),
        });
      }

      const seventh = await asAnon(db, async () =>
        book(db, {
          slug: salon.slug,
          serviceId: salon.serviceId,
          startAt: await nextMonday(db, "10:30", 6),
          phone: "+381647770099",
          deviceId: device,
        }),
      );

      expect(seventh).toEqual({ ok: false, reason: "too_many_from_device" });
    });
  });

  it("drugi uređaj ne nasleđuje tuđi limit", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);

      for (const week of [0, 1, 2, 3, 4, 5]) {
        const phone = `+38164888000${week}`;
        const clientId = await createClient(db, salon.tenantId, phone);
        await insertAsDevice(db, "prvi-telefon", {
          tenantId: salon.tenantId,
          staffId: salon.staffId,
          serviceId: salon.serviceId,
          clientId,
          startAt: await nextMonday(db, "10:30", week),
        });
      }

      const result = await asAnon(db, async () =>
        book(db, {
          slug: salon.slug,
          serviceId: salon.serviceId,
          startAt: await nextMonday(db, "10:30", 6),
          phone: "+381648880099",
          deviceId: "drugi-telefon",
        }),
      );

      expect(result.ok).toBe(true);
    });
  });

  it("dva zakazivanja sa istog uređaja u istom trenutku ne prolaze", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);
      const device = "brzi-prsti";

      const first = await asAnon(db, async () =>
        book(db, {
          slug: salon.slug,
          serviceId: salon.serviceId,
          startAt: await nextMonday(db, "09:00"),
          phone: "+381649990001",
          deviceId: device,
        }),
      );
      const second = await asAnon(db, async () =>
        book(db, {
          slug: salon.slug,
          serviceId: salon.serviceId,
          startAt: await nextMonday(db, "12:00"),
          phone: "+381649990002",
          deviceId: device,
        }),
      );

      expect(first.ok).toBe(true);
      expect(second).toEqual({ ok: false, reason: "too_fast" });
    });
  });

  it("zakazivanje bez uređaja preskače provere uređaja", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);

      const first = await asAnon(db, async () =>
        book(db, {
          slug: salon.slug,
          serviceId: salon.serviceId,
          startAt: await nextMonday(db, "09:00"),
          phone: "+381649991001",
        }),
      );
      const second = await asAnon(db, async () =>
        book(db, {
          slug: salon.slug,
          serviceId: salon.serviceId,
          startAt: await nextMonday(db, "12:00"),
          phone: "+381649991002",
        }),
      );

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
    });
  });

  it("limit jednog salona ne prelazi u drugi", async () => {
    await withRollback(async (db) => {
      const mine = await openSalon(db);
      const theirs = await openSalon(db);
      const phone = "+381645550012";

      for (const time of ["09:00", "10:30"]) {
        const result = await asAnon(db, async () =>
          book(db, {
            slug: mine.slug,
            serviceId: mine.serviceId,
            startAt: await nextMonday(db, time),
            phone,
          }),
        );
        expect(result.ok).toBe(true);
      }

      const elsewhere = await asAnon(db, async () =>
        book(db, {
          slug: theirs.slug,
          serviceId: theirs.serviceId,
          startAt: await nextMonday(db, "12:00"),
          phone,
        }),
      );

      expect(elsewhere.ok).toBe(true);
    });
  });

  it("pomoćna funkcija za limite nije dostupna spolja", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);

      await asAnon(db, async () => {
        await expect(
          inSavepoint(db, () =>
            db.query("select booking_limit_reason($1, $2, now(), null)", [
              salon.tenantId,
              "+381641234567",
            ]),
          ),
        ).rejects.toThrow(/permission denied/i);
      });
    });
  });
});

describe("blokirani broj", () => {
  async function block(
    db: pg.PoolClient,
    tenantId: string,
    phone: string,
  ): Promise<void> {
    await db.query(
      "insert into blocklist (tenant_id, phone_e164, reason) values ($1, $2, 'uzastopno ne dolazi')",
      [tenantId, phone],
    );
  }

  it("ne može da zakaže", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);
      const phone = "+381645551001";
      await block(db, salon.tenantId, phone);

      const result = await asAnon(db, async () =>
        book(db, {
          slug: salon.slug,
          serviceId: salon.serviceId,
          startAt: await nextMonday(db, "10:30"),
          phone,
        }),
      );

      expect(result).toEqual({ ok: false, reason: "blocked" });
    });
  });

  it("blokada ne ostavlja ni klijenta ni termin", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);
      const phone = "+381645551002";
      await block(db, salon.tenantId, phone);

      await asAnon(db, async () =>
        book(db, {
          slug: salon.slug,
          serviceId: salon.serviceId,
          startAt: await nextMonday(db, "10:30"),
          phone,
        }),
      );

      const clients = await db.query(
        "select 1 from clients where tenant_id = $1 and phone_e164 = $2",
        [salon.tenantId, phone],
      );
      expect(clients.rowCount).toBe(0);
    });
  });

  it("blokada u jednom salonu ne važi u drugom", async () => {
    await withRollback(async (db) => {
      const mine = await openSalon(db);
      const theirs = await openSalon(db);
      const phone = "+381645551003";
      await block(db, mine.tenantId, phone);

      const result = await asAnon(db, async () =>
        book(db, {
          slug: theirs.slug,
          serviceId: theirs.serviceId,
          startAt: await nextMonday(db, "10:30"),
          phone,
        }),
      );

      expect(result.ok).toBe(true);
    });
  });

  it("odblokiran broj ponovo zakazuje", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);
      const phone = "+381645551004";
      await block(db, salon.tenantId, phone);
      await db.query(
        "delete from blocklist where tenant_id = $1 and phone_e164 = $2",
        [salon.tenantId, phone],
      );

      const result = await asAnon(db, async () =>
        book(db, {
          slug: salon.slug,
          serviceId: salon.serviceId,
          startAt: await nextMonday(db, "10:30"),
          phone,
        }),
      );

      expect(result.ok).toBe(true);
    });
  });

  it("isti broj se ne može blokirati dva puta u istom salonu", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);
      const phone = "+381645551005";
      await block(db, salon.tenantId, phone);

      await expect(
        inSavepoint(db, () => block(db, salon.tenantId, phone)),
      ).rejects.toThrow(/blocklist_tenant_id_phone_key/);
    });
  });

  it("vlasnica ne vidi ni ne dira tuđu listu blokiranih", async () => {
    await withRollback(async (db) => {
      const mine = await openSalon(db);
      const theirs = await openSalon(db);
      const owner = await createUser(db, mine.tenantId);
      await block(db, theirs.tenantId, "+381645551006");

      const seen = await asUser(db, owner, async () => {
        const rows = await db.query("select 1 from blocklist");
        const deleted = await db.query("delete from blocklist");
        return { rows: rows.rowCount, deleted: deleted.rowCount };
      });

      expect(seen).toEqual({ rows: 0, deleted: 0 });
    });
  });
});

describe("duga usluga pomera ostatak dana", () => {
  it("posle dvočasovne nadogradnje u 9 se može u 11, iako nije na rasporedu", async () => {
    await withRollback(async (db) => {
      // Raspored kakav ima sestrin salon: dolazi se na sat i po.
      const tenantId = await createTenant(db);
      const staffId = await createStaff(db, tenantId);
      const long = await createService(db, tenantId, 120);
      const short = await createService(db, tenantId, 90);

      for (const serviceId of [long, short]) {
        await db.query(
          "insert into staff_services (tenant_id, staff_id, service_id) values ($1, $2, $3)",
          [tenantId, staffId, serviceId],
        );
      }
      await db.query(
        `insert into working_hours
           (tenant_id, staff_id, weekday, start_time, end_time, slot_minutes)
         values ($1, $2, 1, '09:00', '12:00', 90)`,
        [tenantId, staffId],
      );
      await db.query(
        "update tenants set min_lead_minutes = 0, booking_horizon_days = 90 where id = $1",
        [tenantId],
      );
      const slug = (
        await db.query<{ slug: string }>("select slug from tenants where id = $1", [
          tenantId,
        ])
      ).rows[0]!.slug;

      const taken = await asAnon(db, async () =>
        book(db, {
          slug,
          serviceId: long,
          startAt: await nextMonday(db, "09:00"),
          phone: "+381645552001",
        }),
      );
      expect(taken.ok).toBe(true);

      // 10:30 je na rasporedu, ali pada usred nadogradnje.
      const clash = await asAnon(db, async () =>
        book(db, {
          slug,
          serviceId: short,
          startAt: await nextMonday(db, "10:30"),
          phone: "+381645552002",
        }),
      );
      expect(clash).toEqual({ ok: false, reason: "slot_taken" });

      // 11:00 nije na rasporedu, ali je tačno kraj prethodnog termina.
      const shifted = await asAnon(db, async () =>
        book(db, {
          slug,
          serviceId: short,
          startAt: await nextMonday(db, "11:00"),
          phone: "+381645552003",
        }),
      );
      expect(shifted.ok).toBe(true);
    });
  });

  it("nasumično vreme koje nije ni raspored ni kraj tuđeg termina pada", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);

      const result = await asAnon(db, async () =>
        book(db, {
          slug: salon.slug,
          serviceId: salon.serviceId,
          startAt: await nextMonday(db, "11:07"),
        }),
      );

      expect(result).toEqual({ ok: false, reason: "outside_working_hours" });
    });
  });
});

describe("ograničenje po mreži", () => {
  /**
   * Kolačić uređaja se briše za deset sekundi. Ovo pokriva ono što posetilac
   * ne bira sam — adresu sa koje dolazi.
   */
  it("osam zakazivanja sa iste mreže u jednom satu je granica", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db, { horizonDays: 90 });
      const network = "mreza-aaa";

      // Svako sa svojim brojem i svojim uređajem, da granice po broju i po
      // uređaju ne bi presudile pre mrežne.
      for (let i = 0; i < 8; i += 1) {
        const startAt = await nextMonday(db, "09:00", i);
        const result = await asAnon(db, () =>
          book(db, {
            slug: salon.slug,
            serviceId: salon.serviceId,
            startAt,
            phone: `+38164555${String(1000 + i)}`,
            deviceId: `uredjaj-${i}`,
            networkHash: network,
          }),
        );
        expect({ i, ok: result.ok }).toEqual({ i, ok: true });
      }

      const startAt = await nextMonday(db, "10:30", 0);
      const ninth = await asAnon(db, () =>
        book(db, {
          slug: salon.slug,
          serviceId: salon.serviceId,
          startAt,
          phone: "+381645559999",
          deviceId: "uredjaj-9",
          networkHash: network,
        }),
      );

      expect(ninth).toEqual({ ok: false, reason: "too_many_from_network" });
    });
  });

  it("druga mreža nije pogođena tuđim brojanjem", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db, { horizonDays: 90 });

      for (let i = 0; i < 8; i += 1) {
        const startAt = await nextMonday(db, "09:00", i);
        await asAnon(db, () =>
          book(db, {
            slug: salon.slug,
            serviceId: salon.serviceId,
            startAt,
            phone: `+38164556${String(1000 + i)}`,
            deviceId: `uredjaj-${i}`,
            networkHash: "mreza-aaa",
          }),
        );
      }

      const startAt = await nextMonday(db, "10:30", 0);
      const other = await asAnon(db, () =>
        book(db, {
          slug: salon.slug,
          serviceId: salon.serviceId,
          startAt,
          phone: "+381645568888",
          deviceId: "uredjaj-drugi",
          networkHash: "mreza-bbb",
        }),
      );

      expect(other.ok).toBe(true);
    });
  });

  it("bez prosleđene mreže zakazivanje prolazi kao i pre", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);
      const startAt = await nextMonday(db, "09:00");

      const result = await asAnon(db, () =>
        book(db, {
          slug: salon.slug,
          serviceId: salon.serviceId,
          startAt,
          phone: "+381645557777",
        }),
      );

      expect(result.ok).toBe(true);
    });
  });

  it("mreža se upisuje u istoriju, adresa se ne čuva", async () => {
    await withRollback(async (db) => {
      const salon = await openSalon(db);
      const startAt = await nextMonday(db, "09:00");

      await asAnon(db, () =>
        book(db, {
          slug: salon.slug,
          serviceId: salon.serviceId,
          startAt,
          phone: "+381645556666",
          networkHash: "mreza-ccc",
        }),
      );

      const rows = await db.query<{ network_hash: string | null }>(
        `select network_hash from appointment_events
         where tenant_id = $1 and from_status is null`,
        [salon.tenantId],
      );

      expect(rows.rows).toEqual([{ network_hash: "mreza-ccc" }]);
    });
  });
});

describe("izmišljen broj ne prolazi ni direktnim pozivom", () => {
  it("baza ga odbija i kad forma nije ni pitana", async () => {
    // Zaobilaženje forme je jedini scenario koji ovo pokriva: `anon` ključ i
    // slug salona su javni, pa se `public_book` može pozvati i bez stranice.
    await withRollback(async (db) => {
      const salon = await openSalon(db);
      const startAt = await nextMonday(db, "09:00");

      for (const phone of ["+381641111111", "+381641234567"]) {
        const result = await asAnon(db, () =>
          book(db, {
            slug: salon.slug,
            serviceId: salon.serviceId,
            startAt,
            phone,
          }),
        );

        expect({ phone, result }).toEqual({
          phone,
          result: { ok: false, reason: "invalid_phone" },
        });
      }
    });
  });
});
