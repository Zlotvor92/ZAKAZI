import { createHash } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";
import { buildCalendarCancel, buildCalendarEvent } from "@/lib/domain/ics";

/**
 * Termin kao fajl za kalendar.
 *
 * Podaci stižu kroz adresu, ne iz baze. To je namerno: klijentkinja ih je
 * upravo dobila na ekranu potvrde, pa ovde nema šta da se otkrije. Ruta ne
 * dodiruje bazu i ne zna ni za jedan termin — sastavlja fajl od onoga što joj
 * je dato.
 */
const requestSchema = z.object({
  pocetak: z.iso.datetime({ offset: true }),
  kraj: z.iso.datetime({ offset: true }),
  usluga: z.string().min(1).max(80),
  salon: z.string().min(1).max(80),
  /** Isti termin, ali kao poništenje unosa koji je već u kalendaru. */
  otkazano: z.literal("1").optional(),
});

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  const parsed = requestSchema.safeParse({
    pocetak: params.get("pocetak"),
    kraj: params.get("kraj"),
    usluga: params.get("usluga"),
    salon: params.get("salon"),
    otkazano: params.get("otkazano") ?? undefined,
  });

  if (!parsed.success) {
    return new Response("Neispravni podaci termina.", { status: 400 });
  }

  const startAt = new Date(parsed.data.pocetak);
  const endAt = new Date(parsed.data.kraj);

  if (endAt <= startAt) {
    return new Response("Kraj termina mora biti posle početka.", {
      status: 400,
    });
  }

  // Isti termin mora da da isti UID, da drugi preuzeti fajl ne bi napravio
  // duplikat u kalendaru nego zamenio prvi — i da bi poništenje pogodilo unos
  // koji je već tamo. Zato ide trenutak, a ne tekst iz adrese: isti čas zapisan
  // sa „+02:00" i sa „Z" mora da da isti UID.
  const uid = createHash("sha256")
    .update(
      [
        startAt.toISOString(),
        endAt.toISOString(),
        parsed.data.usluga,
        parsed.data.salon,
      ].join("|"),
    )
    .digest("hex")
    .slice(0, 32);

  const event = {
    uid: `${uid}@doterajme`,
    startAt,
    endAt,
    createdAt: new Date(),
    title: `${parsed.data.usluga} — ${parsed.data.salon}`,
    location: parsed.data.salon,
    description: `Termin u salonu ${parsed.data.salon}.`,
  };

  const cancelled = parsed.data.otkazano === "1";
  const body = cancelled
    ? buildCalendarCancel(event)
    : buildCalendarEvent(event);

  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${cancelled ? "otkazan-termin" : "termin"}.ics"`,
      "Cache-Control": "no-store",
    },
  });
}
