// Prijava tačno onako kako README opisuje: /prijava → sandučić na :54324.
import { launch, shot, BASE, MOBILE } from "./drive.mjs";
import { signIn } from "./prijava.mjs";
const { browser, ctx } = await launch(MOBILE);
const page = await ctx.newPage();
try {
  const url = await signIn(page);
  console.log("PRIJAVA KROZ SANDUČIĆ RADI ✓ →", url.replace(BASE, ""));
  console.log("dashboard:", (await page.locator("body").innerText()).replace(/\s+/g," ").slice(0,140));
  await shot(page, "mob-34-prijava-kroz-sanducic");
} catch (e) {
  console.log("PAO ✗:", e.message.slice(0, 200));
}
await browser.close();
