import { launch, shot, auditScreen, BASE, MOBILE } from "./drive.mjs";
import pg from "pg";
const db = new pg.Client({ connectionString: "postgresql://postgres:postgres@127.0.0.1:54322/postgres" });
await db.connect();
const say=(k,v)=>console.log(`${k}: ${v}`);
const { browser } = await launch(MOBILE);

async function otvori() {
  const ctx = await browser.newContext({ ...MOBILE, locale:"sr-RS", timezoneId:"Europe/Belgrade" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/studio-milica/otkazi`, { waitUntil: "networkidle" });
  return { ctx, page };
}
async function trazi(page, tel) {
  await page.getByLabel(/Broj telefona/i).fill(tel);
  await page.getByRole("button", { name: /Pronađi termine/i }).click();
  await page.waitForTimeout(2200);
  return (await page.locator("body").innerText()).replace(/\s+/g," ");
}

// 1. Broj koji NEMA termine — ne sme da oda da li broj postoji
let { ctx, page } = await otvori();
say("1. nepoznat broj", (await trazi(page, "0649998877")).slice(0, 260));
await shot(page, "mob-28-otkazi-nepoznat");
await ctx.close();

// 2. Broj koji IMA termine
({ ctx, page } = await otvori());
let t = await trazi(page, "0645550001");
say("2. poznat broj", t.slice(0, 420));
await shot(page, "mob-29-otkazi-nadjeno");
const otk = page.getByRole("button", { name: /^Otkaži/ });
say("   dugmadi za otkazivanje", await otk.count());
if (await otk.count()) {
  await otk.first().click();
  await page.waitForTimeout(2200);
  const p = (await page.locator("body").innerText()).replace(/\s+/g," ");
  say("3. posle otkazivanja", p.slice(0, 300));
  await shot(page, "mob-30-otkazano");
}
await ctx.close();

const r = await db.query(`select c.name, a.status, e.from_status, e.to_status, e.actor_type
  from appointments a join clients c on c.id=a.client_id
  left join appointment_events e on e.appointment_id=a.id
  where c.phone_e164='+381645550001' order by a.start_at, e.created_at`);
say("4. BAZA posle otkazivanja", JSON.stringify(r.rows));
await db.end(); await browser.close();
