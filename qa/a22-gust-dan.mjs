import { launch, shot, BASE, MOBILE } from "./drive.mjs";
import { signIn } from "./prijava.mjs";
const { browser, ctx } = await launch(MOBILE);
const page = await ctx.newPage();
await signIn(page);
const d = new Date(Date.now()+3*86400000).toISOString().slice(0,10);
await page.goto(`${BASE}/dashboard?dan=${d}`, { waitUntil: "networkidle" });
await page.waitForTimeout(900);
const a = await page.evaluate(`({
  preliv: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  visina: document.documentElement.scrollHeight,
  redova: document.querySelectorAll('li').length
})`);
console.log("gust dan (30 termina):", JSON.stringify(a));
console.log("tekst:", (await page.locator("body").innerText()).replace(/\s+/g," ").slice(0,200));
await shot(page, "vis-gust-dan-30");
await browser.close();
