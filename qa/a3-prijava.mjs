import { launch, shot, auditScreen, BASE, MOBILE } from "./drive.mjs";
import { signIn, magicLink } from "./prijava.mjs";
const { browser, ctx } = await launch(MOBILE);
const page = await ctx.newPage();
const say = (k, v) => console.log(`${k}: ${v}`);

// Neprijavljen na zaštićene strane
for (const r of ["/dashboard", "/admin", "/dashboard/podesavanja", "/dashboard/termin/novi"]) {
  await page.goto(BASE + r, { waitUntil: "networkidle" });
  say(`neprijavljen ${r} -> `, page.url().replace(BASE, ""));
}

const link = await signIn(page);
say("prijava", "uspela -> " + page.url().replace(BASE, ""));
await shot(page, "mob-10-dashboard");
say("dashboard tekst", (await page.locator("body").innerText()).replace(/\s+/g," ").slice(0,330));
say("dashboard audit", JSON.stringify(await auditScreen(page)));

// Prijavljen na / i /prijava -> mora na /dashboard
for (const r of ["/", "/prijava"]) {
  await page.goto(BASE + r, { waitUntil: "networkidle" });
  say(`prijavljen ${r} -> `, page.url().replace(BASE, ""));
}

// Istrošena veza
await page.goto(link, { waitUntil: "networkidle" });
say("istrošena veza ->", page.url().replace(BASE, ""));
say("  tekst", (await page.locator("body").innerText()).replace(/\s+/g," ").slice(0,160));

// Izmenjena veza
await page.goto(`${BASE}/auth/callback?token_hash=deadbeef&type=magiclink`, { waitUntil: "networkidle" });
say("izmenjena veza ->", page.url().replace(BASE, ""));
// Bez parametara
await page.goto(`${BASE}/auth/callback`, { waitUntil: "networkidle" });
say("bez parametara ->", page.url().replace(BASE, ""));
await shot(page, "mob-11-prijava-greska");
say("greška tekst", (await page.locator("body").innerText()).replace(/\s+/g," ").slice(0,200));
await browser.close();
