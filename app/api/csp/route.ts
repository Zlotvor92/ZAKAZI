import { type NextRequest } from "next/server";
import { z } from "zod";
import { logError } from "@/lib/db/errors";
import { cspReportMessage } from "@/lib/domain/csp-report";

/**
 * Prijemnik izveštaja o CSP-u, dok je politika samo `Report-Only`.
 *
 * Pregledač šalje izveštaj sam, bez korisnika, pa ruta uvek odgovara sa 204, i
 * kad dobije smeće. Izveštaj ide u istu evidenciju kao ostale greške, sa
 * istim ograničenjem broja upisa u bazi (`log_error`) — ko hoće da zatrpa
 * evidenciju, ne može više od toga.
 *
 * Adrese se sužavaju na izvor i putanju bez upita (`cspReportMessage`): token
 * kalendara i slični tajni delovi putanje ne smeju da završe u evidenciji.
 */
const reportSchema = z.union([
  // Stari oblik: { "csp-report": { ... } }
  z.object({ "csp-report": z.record(z.string(), z.unknown()) }),
  // Novi oblik (Reporting API): lista { type, body }
  z.array(
    z.object({ type: z.string(), body: z.record(z.string(), z.unknown()) }),
  ),
]);

export async function POST(request: NextRequest) {
  try {
    const text = await request.text();

    if (text.length <= 20_000) {
      const parsed = reportSchema.safeParse(JSON.parse(text));

      if (parsed.success) {
        const bodies = Array.isArray(parsed.data)
          ? parsed.data
              .filter((item) => item.type === "csp-violation")
              .map((item) => item.body)
          : [parsed.data["csp-report"]];

        for (const body of bodies.slice(0, 5)) {
          await logError({
            source: "client",
            message: cspReportMessage(body),
            path: null,
            userAgent: request.headers.get("user-agent"),
          });
        }
      }
    }
  } catch {
    // Namerno tiho — vidi komentar iznad.
  }

  return new Response(null, { status: 204 });
}
