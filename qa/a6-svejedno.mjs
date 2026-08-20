import { launch, shot, BASE, MOBILE } from "./drive.mjs";
const { browser, ctx } = await launch(MOBILE);
const say = (k, v) => console.log(`${k}: ${v}`);
const page = await ctx.newPage();

await page.goto(`${BASE}/studio-milica`, { waitUntil: "networkidle" });
await page.getByTestId("service-option").first().click();
await page.waitForTimeout(400);
const staffBtns = await page.getByTestId("staff-option").allInnerTexts();
say("KORAK 'Kod koga?' se pojavio", staffBtns.length + " opcija: " + JSON.stringify(staffBtns));
await shot(page, "mob-16-kod-koga");
say("ekran", (await page.locator("body").innerText()).replace(/\s+/g," ").slice(0,260));
await browser.close();
