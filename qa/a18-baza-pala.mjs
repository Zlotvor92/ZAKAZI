import { launch, shot, BASE, MOBILE } from "./drive.mjs";
const { browser } = await launch(MOBILE);
const ctx = await browser.newContext({ ...MOBILE, locale:"sr-RS", timezoneId:"Europe/Belgrade" });
const page = await ctx.newPage();
const t0 = Date.now();
try {
  await page.goto(`${BASE}/studio-milica`, { waitUntil: "domcontentloaded", timeout: 45000 });
} catch (e) { console.log("goto pukao posle", ((Date.now()-t0)/1000).toFixed(1), "s:", e.message.slice(0,70)); }
await page.waitForTimeout(3000);
const txt = (await page.locator("body").innerText().catch(()=>"")).replace(/\s+/g," ");
console.log("vreme do ekrana:", ((Date.now()-t0)/1000).toFixed(1), "s");
console.log("ŠTA KORISNIK VIDI:", txt.slice(0,260) || "(PRAZNA BELA STRANA)");
console.log("srpski tekst?", /Nešto|greška|Pokušaj|Nazad|salon/i.test(txt) ? "DA" : "NE");
await shot(page, "mob-32-baza-pala");
await browser.close();
