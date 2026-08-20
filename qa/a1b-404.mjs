import { launch, BASE, MOBILE } from "./drive.mjs";
const { browser, ctx } = await launch(MOBILE);
const page = await ctx.newPage();
const fails = [];
page.on("response", (r) => { if (r.status() >= 400) fails.push(`${r.status()} ${r.url()}`); });
for (const r of ["/", "/studio-milica", "/politika-privatnosti"]) {
  await page.goto(BASE + r, { waitUntil: "networkidle" }); await page.waitForTimeout(500);
  console.log(r, "->", JSON.stringify(fails)); fails.length = 0;
}
await browser.close();
