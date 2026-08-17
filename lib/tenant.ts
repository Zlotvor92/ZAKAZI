import { cookies } from "next/headers";
import { z } from "zod";

const TENANT_COOKIE = "zakazi_salon";
const TENANT_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Salon u kome vlasnica trenutno radi.
 *
 * Kolačić dolazi sa uređaja, pa mu se ne veruje: baza za svaki poslati salon
 * proverava članstvo i nečlanu vraća isto što i za nepostojeći salon. Ovde se
 * proverava samo da je oblik ispravan, da se u upit ne pošalje smeće.
 */
export async function selectedTenantId(): Promise<string | null> {
  const jar = await cookies();
  const parsed = z.uuid().safeParse(jar.get(TENANT_COOKIE)?.value);

  return parsed.success ? parsed.data : null;
}

/** Sme se zvati samo iz server akcije ili rute — komponente ne pišu kolačiće. */
export async function selectTenant(tenantId: string): Promise<void> {
  const jar = await cookies();

  jar.set(TENANT_COOKIE, tenantId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: TENANT_COOKIE_MAX_AGE,
    path: "/",
  });
}
