import { afterAll, describe, expect, it } from "vitest";
import { closePool, withRollback } from "./helpers";

afterAll(closePool);

/**
 * Šta neprijavljen posetilac uopšte može da dodirne.
 *
 * RLS i dalje brani sve sam za sebe. Ovi testovi čuvaju sloj ispod njega: da
 * privilegija ne stoji i ne čeka prvu tabelu kojoj neko zaboravi politiku.
 */
describe("površina za neprijavljene", () => {
  it("nema nijedno pravo ni nad jednom tabelom", async () => {
    await withRollback(async (db) => {
      const result = await db.query<{ tabela: string; pravo: string }>(
        `select c.relname as tabela, p.privilege_type as pravo
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         join information_schema.role_table_grants p
           on p.table_name = c.relname
          and p.table_schema = 'public'
          and p.grantee = 'anon'
         where n.nspname = 'public' and c.relkind = 'r'
         order by c.relname, p.privilege_type`,
      );

      expect(result.rows).toEqual([]);
    });
  });

  it("nova tabela ne dobija prava sama od sebe", async () => {
    await withRollback(async (db) => {
      await db.query("create table proba_nova (id int)");

      const result = await db.query<{ pravo: string }>(
        `select privilege_type as pravo
         from information_schema.role_table_grants
         where table_schema = 'public' and table_name = 'proba_nova'
           and grantee = 'anon'`,
      );

      expect(result.rows).toEqual([]);
    });
  });

  it("sme da pozove tačno ono što javnoj strani treba", async () => {
    await withRollback(async (db) => {
      const result = await db.query<{ proname: string }>(
        `select p.proname
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.prokind = 'f'
           and has_function_privilege('anon', p.oid, 'execute')
           -- Funkcije koje dolaze uz btree_gist su deo indeksa, ne našeg API-ja.
           and p.proname not like 'gbt%'
           and p.proname not like '%_dist'
           and p.proname not in ('timerange', 'timemultirange')
         order by p.proname`,
      );

      expect(result.rows.map((row) => row.proname)).toEqual([
        // Čisti računski pomoćnik nad minutima, bez pristupa ijednoj tabeli.
        "add_minutes",
        // Spisak termina za dati broj, na strani za otkazivanje.
        "public_appointments_for_phone",
        "public_book",
        "public_booking_data",
        // Otkazivanje termina od strane klijentkinje koja ga je zakazala.
        "public_cancel_appointment",
        // Ime, boje i logo salona za stranu za otkazivanje, van gejta
        // `public_booking_enabled` — otkazivanje radi i kad je zakazivanje
        // ručno isključeno.
        "public_salon_summary",
        // Triger funkcija; pozvana direktno puca, jer nema reda nad kojim radi.
        "set_updated_at",
      ]);
    });
  });

  it("javno zakazivanje radi i bez ijedne privilegije nad tabelama", async () => {
    await withRollback(async (db) => {
      // `security definer` znači da funkcija tabelama pristupa kao vlasnik,
      // pa oduzimanje prava pozivaocu ne sme ništa da polomi.
      const result = await db.query<{ data: unknown }>(
        "select public_booking_data('ne-postoji') as data",
      );

      expect(result.rows[0]!.data).toBeNull();
    });
  });
});
