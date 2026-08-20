import { launch, shot, BASE, MOBILE } from "./drive.mjs";
import pg from "pg";
const db = new pg.Client({ connectionString: "postgresql://postgres:postgres@127.0.0.1:54322/postgres" });
await db.connect();
const say=(k,v)=>console.log(`${k}: ${v}`);
const { browser, ctx } = await launch(MOBILE);
const page = await ctx.newPage();
await page.goto(`${BASE}/studio-milica/otkazi`, { waitUntil: "networkidle" });
await page.getByLabel(/Broj telefona/i).fill("0645550001");
await page.getByRole("button", { name: /Pronađi termine/i }).click();
await page.waitForTimeout(2200);
await page.getByRole("button", { name: /^Otkaži/ }).first().click();
await page.waitForTimeout(500);
await page.getByRole("button", { name: /Sigurno otkazujem/ }).first().click();
await page.waitForTimeout(2500);
say("posle potvrde", (await page.locator("body").innerText()).replace(/\s+/g," ").slice(0,320));
await shot(page, "mob-30-otkazano");
const r = await db.query(`select a.status, e.from_status, e.to_status, e.actor_type
  from appointments a join clients c on c.id=a.client_id
  left join appointment_events e on e.appointment_id=a.id
  where c.phone_e164='+381645550001' order by a.start_at, e.created_at`);
say("BAZA", JSON.stringify(r.rows));
await db.end(); await browser.close();
