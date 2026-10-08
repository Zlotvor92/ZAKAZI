import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getMyTenants } from "@/lib/db/tenants";
import { selectTenant } from "@/lib/tenant";

const querySchema = z.object({
  salon: z.uuid(),
  dan: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/**
 * Cilj dodira na obaveštenje: izabere salon iz obaveštenja i otvori kalendar tog
 * dana. Salon se prihvata samo ako je nalog u njemu član — kolačić bi inače
 * ostao zaključan na salonu koji korisnica ne vidi.
 *
 * Neprijavljenu posetiteljku middleware vraća na prijavu pre nego što stigne
 * ovamo. Pogrešan ili tuđ salon ne daje grešku nego običan kalendar.
 */
export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse({
    salon: request.nextUrl.searchParams.get("salon"),
    dan: request.nextUrl.searchParams.get("dan"),
  });

  if (!parsed.success) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  const mine = await getMyTenants();

  if (!mine.some((tenant) => tenant.id === parsed.data.salon)) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  await selectTenant(parsed.data.salon);

  return NextResponse.redirect(
    new URL(`/dashboard?dan=${parsed.data.dan}`, request.url),
  );
}
