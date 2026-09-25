import { timingSafeEqual } from "node:crypto";
import { type NextRequest } from "next/server";
import { completePastAppointments } from "@/lib/db/appointments";
import { requireEnv } from "@/lib/env";

/**
 * Noćni posao: termini iz prošlog dana postaju obavljeni.
 *
 * Vercel ga zove po rasporedu iz `vercel.json` i šalje `CRON_SECRET` kao
 * Bearer token. Ko ga nema, dobija 401. Kad promenljiva nije podešena, ruta
 * puca sa porukom koja kaže šta fali — zaboravljen ključ ne sme da znači
 * otvorena vrata.
 */
function authorized(request: NextRequest): boolean {
  const expected = Buffer.from(`Bearer ${requireEnv("CRON_SECRET")}`);
  const received = Buffer.from(request.headers.get("authorization") ?? "");

  return (
    received.length === expected.length && timingSafeEqual(received, expected)
  );
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return new Response(null, { status: 401 });
  }

  const completed = await completePastAppointments();

  return Response.json({ completed });
}
