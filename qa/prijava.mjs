import { BASE } from "./drive.mjs";

// Lokalni Supabase uvek ispisuje isti ključ; `supabase status -o json` ga daje.
// Ovde se čita iz okruženja da se ni takav ne bi upisivao u repo.
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SRK) {
  throw new Error("Nedostaje SUPABASE_SERVICE_ROLE_KEY (uzmi ga iz `supabase status -o json`).");
}

/**
 * Prijava kroz pravu `/auth/callback` rutu aplikacije.
 *
 * Link se dobija iz admin API-ja umesto iz sandučeta, jer je u lokalnom
 * steku mejl provajder ugašen (`GOTRUE_EXTERNAL_EMAIL_ENABLED=false`) —
 * vidi nalaz o `supabase/config.toml`. Ruta koja se testira je ista.
 */
export async function magicLink(email = "vlasnik@primer.rs") {
  const res = await fetch("http://127.0.0.1:54321/auth/v1/admin/generate_link", {
    method: "POST",
    headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "magiclink", email }),
  });
  const data = await res.json();
  if (!data.hashed_token) throw new Error("Nema tokena: " + JSON.stringify(data).slice(0, 300));
  return `${BASE}/auth/callback?token_hash=${data.hashed_token}&type=magiclink`;
}

export async function signIn(page, email = "vlasnik@primer.rs") {
  const link = await magicLink(email);
  await page.goto(link, { waitUntil: "networkidle" });
  if (!page.url().includes("/dashboard")) {
    throw new Error("Prijava nije uspela, zavrsio na: " + page.url());
  }
  return link;
}
