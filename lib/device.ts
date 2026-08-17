import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";

const DEVICE_COOKIE = "zakazi_device";
const DEVICE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Uređaj sa kog je izmena došla, radi istorije promena. Nasumičan broj bez
 * ijednog podatka o osobi, koji preživi zatvaranje stranice da bi se dve
 * izmene sa istog telefona mogle povezati.
 */
export async function deviceId(): Promise<string> {
  const jar = await cookies();
  const existing = jar.get(DEVICE_COOKIE)?.value;

  if (existing) {
    return existing;
  }

  const fresh = randomUUID();
  jar.set(DEVICE_COOKIE, fresh, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: DEVICE_COOKIE_MAX_AGE,
    path: "/",
  });

  return fresh;
}
