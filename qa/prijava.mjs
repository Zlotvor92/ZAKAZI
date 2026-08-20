import { BASE } from "./drive.mjs";

const SANDUCE = "http://127.0.0.1:54324";

/**
 * Prijava kroz pravi tok iz README-a: `/prijava` → sandučić → veza.
 *
 * Dok je `[auth.email] enable_signup` bio `false`, CLI je time gasio i sam
 * mejl provajder, pa poruka nikad nije stizala i ovo je moralo da ide preko
 * admin API-ja. Sada radi kako i treba.
 */
export async function signIn(page, email = "vlasnik@primer.rs") {
  await fetch(`${SANDUCE}/api/v1/messages`, { method: "DELETE" }).catch(() => {});

  await page.goto(`${BASE}/prijava`, { waitUntil: "networkidle" });
  await page.getByLabel(/Mejl/i).fill(email);
  await page.getByRole("button", { name: /Pošalji/i }).click();

  let poruka;
  for (let i = 0; i < 20 && !poruka; i++) {
    await page.waitForTimeout(500);
    const lista = await (await fetch(`${SANDUCE}/api/v1/messages`)).json();
    poruka = lista.messages?.[0];
  }
  if (!poruka) {
    throw new Error("Poruka za prijavu nije stigla u sandučić.");
  }

  const cela = await (await fetch(`${SANDUCE}/api/v1/message/${poruka.ID}`)).json();
  const telo = cela.HTML || cela.Text || "";
  // Supabase šalje vezu ka `/auth/v1/verify?token=…`, koja onda preusmerava na
  // `redirect_to`. Stariji oblik sa `token_hash` ide pravo na našu rutu.
  const nadjeno = /https?:\/\/[^\s"'<>]*(?:token_hash|token|code)=[^\s"'<>]+/.exec(telo);
  if (!nadjeno) {
    throw new Error(`Veza nije nađena u poruci: ${telo.slice(0, 300)}`);
  }

  await page.goto(nadjeno[0].replace(/&amp;/g, "&"), { waitUntil: "networkidle" });
  if (!page.url().includes("/dashboard")) {
    throw new Error(`Prijava nije uspela, završila na: ${page.url()}`);
  }
  return page.url();
}
