import { launch, shot, BASE, MOBILE } from "./drive.mjs";
import pg from "pg";
const db = new pg.Client({ connectionString: "postgresql://postgres:postgres@127.0.0.1:54322/postgres" });
await db.connect();
const say = (k, v) => console.log(`${k}: ${v}`);
const { browser } = await launch(MOBILE);

async function stanje(nap) {
  const r = await db.query(`select to_char(a.start_at at time zone 'Europe/Belgrade','DD.MM HH24:MI') as kada,
      st.name as izvodjac, c.name as klijent, a.status from appointments a
      join staff st on st.id=a.staff_id join clients c on c.id=a.client_id
      join tenants t on t.id=a.tenant_id where t.slug='studio-milica' order by a.start_at, st.name`);
  say(`BAZA ${nap}`, JSON.stringify(r.rows));
}

async function otvori(kod) {
  const ctx = await browser.newContext({ ...MOBILE, locale: "sr-RS", timezoneId: "Europe/Belgrade" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/studio-milica`, { waitUntil: "networkidle" });
  await page.getByTestId("service-option").first().click();
  await page.waitForTimeout(400);
  if (kod === "svejedno") await page.getByRole("button", { name: /Svejedno mi je/ }).click();
  else await page.getByTestId("staff-option").filter({ hasText: kod }).first().click();
  await page.waitForTimeout(400);
  await page.getByTestId("day-option").first().click();
  await page.waitForTimeout(300);
  return { ctx, page };
}

async function posalji(page, ime, tel, sat) {
  await page.getByTestId("slot-option").filter({ hasText: sat }).first().click();
  await page.waitForTimeout(300);
  await page.getByLabel(/Ime/i).fill(ime);
  await page.getByLabel(/Broj telefona/i).fill(tel);
  await page.getByRole("button", { name: /Zakaži termin/i }).click();
  await page.waitForTimeout(2500);
  return (await page.locator("body").innerText()).replace(/\s+/g, " ");
}

await stanje("na početku (Milica zauzeta 10:30)");

// A) SVEJEDNO: 10:30 mora i dalje biti u ponudi (Jovana je slobodna).
let { ctx, page } = await otvori("svejedno");
const sviSvejedno = (await page.getByTestId("slot-option").allInnerTexts()).map(s=>s.trim());
say("A. SVEJEDNO nudi", sviSvejedno.join(" "));
say("A. je li 10:30 i dalje u ponudi?", sviSvejedno.includes("10:30") ? "DA — ispravno" : "NE — GREŠKA");
await shot(page, "mob-17-svejedno-unija");
const r1 = await posalji(page, "Bojana Bojanić", "0641000002", "10:30");
say("A. ishod", r1.slice(0, 130));
await ctx.close();
await stanje("posle svejedno-rezervacije");

// B) IZRIČITO Milica u 10:30 — mora „zauzeto", ne tiho prebacivanje.
({ ctx, page } = await otvori("Milica"));
const miliciniSati = (await page.getByTestId("slot-option").allInnerTexts()).map(s=>s.trim());
say("B. Milica nudi", miliciniSati.join(" ") || "(nijedan)");
say("B. je li 10:30 sklonjen iz Miličine ponude?", miliciniSati.includes("10:30") ? "NIJE — GREŠKA" : "JESTE — ispravno");
await shot(page, "mob-18-milica-bez-1030");
await ctx.close();

// C) SVEJEDNO ponovo: 10:30 sada mora da nestane (oboje zauzeti).
({ ctx, page } = await otvori("svejedno"));
const posle = (await page.getByTestId("slot-option").allInnerTexts()).map(s=>s.trim());
say("C. SVEJEDNO sada nudi", posle.join(" ") || "(nijedan)");
say("C. je li 10:30 nestao iz ponude?", posle.includes("10:30") ? "NIJE — GREŠKA" : "JESTE — ispravno");
await shot(page, "mob-19-1030-nestao");
await ctx.close();
await db.end(); await browser.close();
