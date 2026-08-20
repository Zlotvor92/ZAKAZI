import { launch, shot, BASE, MOBILE } from "./drive.mjs";
import { signIn } from "./prijava.mjs";
const { browser, ctx } = await launch(MOBILE);
const page = await ctx.newPage();
await signIn(page);
console.log("prijavljen, sada rušim vezu ka bazi…");
process.stdout.write("SIGNAL\n");
// čeka da spoljni skript zaustavi PostgREST
await new Promise(r => setTimeout(r, 9000));
await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" }).catch(e=>console.log("goto:", e.message.slice(0,60)));
await page.waitForTimeout(2500);
const t = (await page.locator("body").innerText()).replace(/\s+/g," ");
console.log("EKRAN:", t.slice(0, 300) || "(PRAZNO — bela strana!)");
console.log("ima li puta nazad?", /Nazad|Pokušaj|Osveži|početak/i.test(t) ? "DA" : "NE");
await shot(page, "mob-32-granica-greske");
await browser.close();
