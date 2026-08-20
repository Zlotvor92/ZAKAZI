import { launch, shot, BASE, MOBILE } from "./drive.mjs";
const { browser } = await launch(MOBILE);
const say = (k, v) => console.log(`${k}: ${v}`);

async function zakazi(tel, ime, satTekst) {
  const ctx = await browser.newContext({ ...MOBILE, locale: "sr-RS", timezoneId: "Europe/Belgrade" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/studio-milica`, { waitUntil: "networkidle" });
  await page.getByTestId("service-option").first().click();
  await page.waitForTimeout(400);
  if (await page.getByTestId("staff-option").count()) {
    await page.getByRole("button", { name: /Svejedno mi je/ }).click(); await page.waitForTimeout(400);
  }
  await page.getByTestId("day-option").first().click();
  await page.waitForTimeout(300);
  const sati = (await page.getByTestId("slot-option").allInnerTexts()).map(s=>s.trim());
  const meta = satTekst ?? sati[0];
  if (!sati.includes(meta)) { await ctx.close(); return { greska: `nema sata ${meta}, ima: ${sati.join(" ")}` }; }
  await page.getByTestId("slot-option").filter({ hasText: meta }).first().click();
  await page.waitForTimeout(300);
  await page.getByLabel(/Ime/i).fill(ime);
  await page.getByLabel(/Broj telefona/i).fill(tel);
  await page.getByRole("button", { name: /Zakaži termin/i }).click();
  await page.waitForTimeout(2600);
  const t = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  const uspeh = t.includes("Termin je zakazan");
  await shot(page, `mob-20-limit-${ime.replace(/\W/g,"")}`);
  await ctx.close();
  return { uspeh, sat: meta, tekst: t.slice(0, 230) };
}

const TEL = "0645550001";
say("1. prvi termin", JSON.stringify(await zakazi(TEL, "Limit Prvi", "17:00")));
say("2. drugi termin", JSON.stringify(await zakazi(TEL, "Limit Drugi", "18:30")));
say("3. TREĆI termin (limit 2/nedeljno)", JSON.stringify(await zakazi(TEL, "Limit Treci", null)));
await browser.close();
