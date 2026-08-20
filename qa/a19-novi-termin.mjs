import { launch, shot, auditScreen, BASE, MOBILE } from "./drive.mjs";
import { signIn } from "./prijava.mjs";
import pg from "pg";
const db = new pg.Client({ connectionString: "postgresql://postgres:postgres@127.0.0.1:54322/postgres" });
await db.connect();
const say=(k,v)=>console.log(`${k}: ${v}`);
const { browser, ctx } = await launch(MOBILE);
const page = await ctx.newPage();
await signIn(page);
await page.goto(`${BASE}/dashboard/termin/novi`, { waitUntil: "networkidle" });
await page.waitForTimeout(500);
await shot(page, "mob-33-novi-termin");
say("polja", (await page.locator("label").allInnerTexts()).join(" | "));
say("audit", JSON.stringify(await auditScreen(page)).slice(0,420));
// Ima li izbor izvođača (dvoje ih je)?
const t = (await page.locator("body").innerText()).replace(/\s+/g," ");
say("ima 'Kod koga'?", /Kod koga/.test(t) ? "DA ✓ (jer ih je dvoje)" : "NE ✗");
say("napomena", (t.match(/Termin van radnog vremena[^.]*\./)||["(nema)"])[0]);

// Unesi termin VAN radnog vremena kod Jovane
const sutra = new Date(Date.now()+86400000).toISOString().slice(0,10);
await page.getByLabel(/Datum/i).fill(sutra);
await page.getByLabel(/^Vreme/i).fill("23:15");
const izbori = page.locator("select");
say("broj select polja", await izbori.count());
for (let i=0;i<await izbori.count();i++) {
  const opts = await izbori.nth(i).locator("option").allInnerTexts();
  say(`  select ${i}`, opts.join(" / ").slice(0,90));
}
await page.getByLabel(/Ime klijenta/i).fill("Van Radnog Vremena");
await page.getByLabel(/Broj telefona/i).fill("0647778899");
const sel = page.locator("select");
if (await sel.count() > 1) await sel.nth(1).selectOption({ label: "Jovana" }).catch(()=>{});
await page.getByRole("button", { name: /Sačuvaj termin/i }).click();
await page.waitForTimeout(2500);
say("ishod", (await page.locator("body").innerText()).replace(/\s+/g," ").slice(0,200));
const r = await db.query(`select st.name as izvodjac, to_char(a.start_at at time zone 'Europe/Belgrade','DD.MM HH24:MI') as kada, a.source
  from appointments a join staff st on st.id=a.staff_id join clients c on c.id=a.client_id where c.name='Van Radnog Vremena'`);
say("BAZA", JSON.stringify(r.rows));
await db.end(); await browser.close();
