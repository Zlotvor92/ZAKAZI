import { type NextRequest } from "next/server";
import { z } from "zod";
import { logError } from "@/lib/db/errors";

/**
 * Prijava greške iz pregledača.
 *
 * Zove je granica greške, sa strane koja se upravo raspala. Zato ruta uvek
 * odgovara sa 204, i kad joj se pošalje smeće: pregledač koji je već u
 * problemu ne sme da dobije još jedan.
 *
 * Ograničenje broja upisa stoji u bazi, u `log_error`, a ne ovde — tako važi
 * i za greške sa servera, koje ovuda ne prolaze.
 */
const reportSchema = z.object({
  message: z.string().max(500),
  digest: z.string().max(64).nullish(),
  path: z.string().max(300).nullish(),
  stack: z.string().max(8000).nullish(),
});

export async function POST(request: NextRequest) {
  try {
    const parsed = reportSchema.safeParse(await request.json());

    if (parsed.success) {
      await logError({
        source: "client",
        message: parsed.data.message,
        digest: parsed.data.digest ?? null,
        path: parsed.data.path ?? null,
        stack: parsed.data.stack ?? null,
        userAgent: request.headers.get("user-agent"),
      });
    }
  } catch {
    // Namerno tiho — vidi komentar iznad.
  }

  return new Response(null, { status: 204 });
}
