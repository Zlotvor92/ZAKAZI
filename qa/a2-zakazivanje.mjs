import { launch, auditScreen, shot, BASE, MOBILE } from "./drive.mjs";
const { browser, ctx } = await launch(MOBILE);
const page = await ctx.newPage();
const log = (...a) => console.log(...a);

await page.goto(`${BASE}/studio-milica`, { waitUntil: "networkidle" });

// 1. Sa jednim izvođačem koraka „Kod koga?" ne sme biti.
await page.getByTestId("service-option").first().click();
await page.waitForTimeout(300);
const staffStep = await page.getByTestId("staff-option").count();
log("KORAK-1 jedan izvođač -> broj staff-option dugmadi:", staffStep, staffStep === 0 ? "OK (nema koraka)" : "GREŠKA");
await shot(page, "mob-07-posle-usluge-jedan-izvodjac");
const body1 = (await page.locator("body").innerText()).replace(/\s+/g," ");
log("Ekran posle izbora usluge:", body1.slice(0, 200));

// 2. Prođi do kraja i zapamti izabrani sat.
await page.getByTestId("day-option").first().click();
await page.waitForTimeout(200);
const slots = await page.getByTestId("slot-option").allInnerTexts();
log("Ponuđeni sati (prvih 12):", slots.slice(0,12).join(" "));
const chosen = slots[0].trim();
await page.getByTestId("slot-option").first().click();
await page.waitForTimeout(300);
await shot(page, "mob-08-forma-ime-telefon");

// 3. Prazno ime i neispravan telefon.
await page.getByRole("button", { name: /Zakaži/i }).click().catch(()=>{});
await page.waitForTimeout(600);
log("Prazno ime ->", (await page.locator("body").innerText()).replace(/\s+/g," ").slice(0,260));
await browser.close();
