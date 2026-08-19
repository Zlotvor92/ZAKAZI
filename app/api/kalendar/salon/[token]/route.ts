import { type NextRequest } from "next/server";
import { z } from "zod";
import { getCalendarFeed } from "@/lib/db/calendar";
import { buildCalendarFeed } from "@/lib/domain/ics";

/**
 * Kalendar salona, onako kako ga Google ili Apple povlače.
 *
 * Bez prijave: kalendar aplikacija ne ume da se prijavi, pa je token u adresi
 * jedini dokaz. Netačan token dobija prazan kalendar, ne grešku — inače bi se
 * pogađanjem moglo saznati koji tokeni postoje.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const parsed = z.uuid().safeParse(token);

  const rows = parsed.success ? await getCalendarFeed(parsed.data) : [];

  const body = buildCalendarFeed({
    name: rows[0]?.tenant_name ?? "Doteraj Me",
    createdAt: new Date(),
    events: rows.map((row) => ({
      // Isti termin mora uvek da da isti UID, inače kalendar pravi duplikat
      // umesto da osveži postojeći unos.
      uid: `${row.appointment_id}@doterajme`,
      startAt: new Date(row.start_at),
      endAt: new Date(row.end_at),
      title: `${row.client_name} — ${row.service_name}`,
      location: row.tenant_name,
      description: [
        row.client_phone,
        row.staff_name,
        row.status === "pending" ? "Čeka potvrdu" : null,
      ]
        .filter(Boolean)
        .join("\n"),
    })),
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      // Bez `attachment`: fajl treba da se pretplati, ne da se preuzme.
      "Content-Disposition": 'inline; filename="salon.ics"',
      "Cache-Control": "private, max-age=300",
    },
  });
}
