import { launch, shot, auditScreen, BASE, MOBILE } from "./drive.mjs";
import { signIn } from "./prijava.mjs";
import pg from "pg";
const db = new pg.Client({ connectionString: "postgresql://postgres:postgres@127.0.0.1:54322/postgres" });
await db.connect();
const { browser, ctx } = await launch(MOBILE);
const page = await ctx.newPage();
const say=(k,v)=>console.log(`${k}: ${v}`);
await signIn(page);
await page.waitForTimeout(600);
await shot(page, "mob-24-kalendar-dan");
const t = (await page.locator("body").innerText()).replace(/\s+/g," ");
say("DAN sa terminima", t.slice(0, 500));
say("audit", JSON.stringify(await auditScreen(page)).slice(0,300));

// Ime izvođača mora da se vidi jer ih ima dvoje
say("prikazuje li ime izvođača (Milica/Jovana)?", /Milica|Jovana/.test(t) ? "DA ✓" : "NE ✗");

// Otvori prvi red termina
const redovi = page.locator('button').filter({ hasText: /Gel nokti|Korekcija|Nadogradnja/ });
say("redova termina", await redovi.count());
if (await redovi.count()) {
  await redovi.first().click();
  await page.waitForTimeout(900);
  await shot(page, "mob-25-termin-otvoren");
  const d = (await page.locator("body").innerText()).replace(/\s+/g," ");
  say("otvoren red", d.slice(0, 620));
}
await db.end(); await browser.close();
