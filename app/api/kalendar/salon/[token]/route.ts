import { type NextRequest } from "next/server";
import { z } from "zod";
import { getCalendarFeed } from "@/lib/db/calendar";
import { buildCalendarFeed } from "@/lib/domain/ics";
import { sr } from "@/lib/i18n/sr";

/**
 * Kalendar salona, onako kako ga Google ili Apple povlače.
 *
 * Bez prijave: kalendar aplikacija ne ume da se prijavi, pa je token u adresi
 * jedini dokaz. Netačan token dobija prazan kalendar, ne grešku — inače bi se
 * pogađanjem moglo saznati koji tokeni postoje.
 *
 * Otkazan termin ostaje u odgovoru dok mu vreme ne prođe, ali kao poništen.
 * Aplikacija ga tada skloni zato što joj je rečeno, a ne zato što je red
 * nestao — to drugo ne ume svaka.
 *
 * Adresa sme da se završi sa `.ics`, i tako se i nudi. Deo kalendar
 * aplikacija gleda nastavak u adresi umesto `Content-Type` zaglavlja, pa im
 * adresa koja se završava tokenom ne liči na kalendar. Goli token i dalje
 * radi: pretplate koje su već u tuđim telefonima ne smeju da stanu.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const parsed = z.uuid().safeParse(token.replace(/\.ics$/, ""));

  const rows = parsed.success ? await getCalendarFeed(parsed.data) : [];

  const body = buildCalendarFeed({
    name: rows[0]?.tenant_name ?? sr.app.name,
    createdAt: new Date(),
    empty: {
      title: sr.settings.calendarEmptyTitle,
      description: sr.settings.calendarEmptyBody,
    },
    events: rows.map((row) => ({
      // Isti termin mora uvek da da isti UID, inače kalendar pravi duplikat
      // umesto da osveži postojeći unos.
      uid: `${row.appointment_id}@doterajme`,
      startAt: new Date(row.start_at),
      endAt: new Date(row.end_at),
      title: `${row.client_name} — ${row.service_name}`,
      location: row.tenant_name,
      description: [row.client_phone, row.staff_name].join("\n"),
      cancelled: row.status.startsWith("cancelled"),
    })),
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      // Bez `Content-Disposition`: ovo nije fajl koji se preuzima nego
      // adresa na koju se kalendar pretplaćuje, a zaglavlje je deo
      // aplikacija guralo ka preuzimanju. Kalendari koji svuda rade ga
      // ne šalju.
      "Cache-Control": "private, max-age=300",
    },
  });
}
