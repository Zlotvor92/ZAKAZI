import { launch, BASE, MOBILE } from "./drive.mjs";
import { signIn } from "./prijava.mjs";
import pg from "pg";
const db = new pg.Client({ connectionString: "postgresql://postgres:postgres@127.0.0.1:54322/postgres" });
await db.connect();
const { browser, ctx } = await launch(MOBILE);
const page = await ctx.newPage();
await signIn(page);
await page.goto(`${BASE}/dashboard/termin/novi`, { waitUntil: "networkidle" });
const sutra = new Date(Date.now()+86400000).toISOString().slice(0,10);
await page.getByLabel(/Datum/i).fill(sutra);
await page.getByLabel(/^Vreme/i).fill("21:00");
await page.getByLabel(/Kod koga/i).selectOption({ label: "Jovana" });
await page.getByLabel(/Ime klijenta/i).fill("Kod Jovane");
await page.getByLabel(/Broj telefona/i).fill("0647778811");
await page.getByRole("button", { name: /Sačuvaj termin/i }).click();
await page.waitForTimeout(2500);
const r = await db.query(`select st.name as izvodjac, st.id as staff_id, to_char(a.start_at at time zone 'Europe/Belgrade','DD.MM HH24:MI') as kada
  from appointments a join staff st on st.id=a.staff_id join clients c on c.id=a.client_id where c.name='Kod Jovane'`);
console.log("izabrana Jovana -> BAZA:", JSON.stringify(r.rows));
// Zauzet sat kod ISTE osobe mora da bude odbijen
await page.goto(`${BASE}/dashboard/termin/novi`, { waitUntil: "networkidle" });
await page.getByLabel(/Datum/i).fill(sutra);
await page.getByLabel(/^Vreme/i).fill("21:00");
await page.getByLabel(/Kod koga/i).selectOption({ label: "Jovana" });
await page.getByLabel(/Ime klijenta/i).fill("Dupli Kod Jovane");
await page.getByLabel(/Broj telefona/i).fill("0647778812");
await page.getByRole("button", { name: /Sačuvaj termin/i }).click();
await page.waitForTimeout(2500);
const t=(await page.locator("body").innerText()).replace(/\s+/g," ");
console.log("isti sat kod Jovane ->", (t.match(/To vreme[^.]*\.|zauzet[^.]*\./i)||[t.slice(0,120)])[0]);
// Isti sat kod DRUGE osobe mora da prođe
await page.goto(`${BASE}/dashboard/termin/novi`, { waitUntil: "networkidle" });
await page.getByLabel(/Datum/i).fill(sutra);
await page.getByLabel(/^Vreme/i).fill("21:00");
await page.getByLabel(/Kod koga/i).selectOption({ label: "Milica" });
await page.getByLabel(/Ime klijenta/i).fill("Isti Sat Kod Milice");
await page.getByLabel(/Broj telefona/i).fill("0647778813");
await page.getByRole("button", { name: /Sačuvaj termin/i }).click();
await page.waitForTimeout(2500);
const r2 = await db.query(`select c.name, st.name as izvodjac, to_char(a.start_at at time zone 'Europe/Belgrade','DD.MM HH24:MI') as kada
  from appointments a join staff st on st.id=a.staff_id join clients c on c.id=a.client_id
  where c.name in ('Kod Jovane','Dupli Kod Jovane','Isti Sat Kod Milice') order by st.name`);
console.log("KONAČNO STANJE:", JSON.stringify(r2.rows));
await db.end(); await browser.close();
