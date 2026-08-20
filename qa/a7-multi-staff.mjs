import { launch, shot, BASE, MOBILE } from "./drive.mjs";
import pg from "pg";
const db = new pg.Client({ connectionString: "postgresql://postgres:postgres@127.0.0.1:54322/postgres" });
await db.connect();
const say = (k, v) => console.log(`${k}: ${v}`);

async function stanje(nap) {
  const r = await db.query(`select to_char(a.start_at at time zone 'Europe/Belgrade','DD.MM HH24:MI') as kada,
      st.name as izvodjac, c.name as klijent, a.status, a.source
    from appointments a join staff st on st.id=a.staff_id join clients c on c.id=a.client_id
    join tenants t on t.id=a.tenant_id where t.slug='studio-milica' order by a.start_at, st.name`);
  say(`BAZA ${nap}`, JSON.stringify(r.rows));
}

const { browser } = await launch(MOBILE);

/** Zakaži kao svež klijent (svež kontekst = svež device cookie). */
async function zakazi({ ime, telefon, kodKoga, satIndex = 0, danIndex = 0 }) {
  const ctx = await browser.newContext({ ...MOBILE, locale: "sr-RS", timezoneId: "Europe/Belgrade" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/studio-milica`, { waitUntil: "networkidle" });
  await page.getByTestId("service-option").first().click();
  await page.waitForTimeout(400);
  if (await page.getByTestId("staff-option").count()) {
    await page.getByTestId("staff-option").filter({ hasText: kodKoga }).first().click();
    await page.waitForTimeout(400);
  }
  await page.getByTestId("day-option").nth(danIndex).click();
  await page.waitForTimeout(300);
  const sati = await page.getByTestId("slot-option").allInnerTexts();
  const sat = sati[satIndex]?.trim();
  await page.getByTestId("slot-option").nth(satIndex).click();
  await page.waitForTimeout(300);
  await page.getByLabel(/Ime/i).fill(ime);
  await page.getByLabel(/Broj telefona/i).fill(telefon);
  await page.getByRole("button", { name: /Zakaži termin/i }).click();
  await page.waitForTimeout(2500);
  const tekst = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  await ctx.close();
  return { sat, ponudjeni: sati, tekst: tekst.slice(0, 200) };
}

// 1. Milica dobija izričito izabran termin.
const a = await zakazi({ ime: "Ana Anić", telefon: "0641000001", kodKoga: "Milica" });
say("1. IZRIČITO Milica, sat", a.sat);
say("   ponuđeni sati", a.ponudjeni.join(" "));
say("   ishod", a.tekst.slice(0, 120));
await stanje("posle 1");

// 2. Isti sat pod „Svejedno mi je" mora i dalje da bude u ponudi.
const ctx2 = await browser.newContext({ ...MOBILE, locale: "sr-RS", timezoneId: "Europe/Belgrade" });
const p2 = await ctx2.newPage();
await p2.goto(`${BASE}/studio-milica`, { waitUntil: "networkidle" });
await p2.getByTestId("service-option").first().click();
await p2.waitForTimeout(400);
await p2.getByTestId("staff-option").filter({ hasText: "Svejedno" }).first().click();
await p2.waitForTimeout(400);
await p2.getByTestId("day-option").first().click();
await p2.waitForTimeout(300);
const svejedno = await p2.getByTestId("slot-option").allInnerTexts();
say("2. SVEJEDNO nudi", svejedno.join(" "));
say("   da li je zauzeti " + a.sat + " i dalje u ponudi?", svejedno.map(s=>s.trim()).includes(a.sat) ? "DA (ispravno — druga osoba je slobodna)" : "NE (GREŠKA)");
await shot(p2, "mob-17-svejedno-unija");
await ctx2.close();
await db.end();
await browser.close();
