import { launch, auditScreen, shot, BASE, MOBILE } from "./drive.mjs";

const rute = [
  ["/", "01-pocetna"],
  ["/studio-milica", "02-salon"],
  ["/studio-milica/otkazi", "03-otkazi"],
  ["/politika-privatnosti", "04-privatnost"],
  ["/uslovi-koriscenja", "05-uslovi"],
  ["/nema-ovakvog-salona", "06-nepostojeci-salon"],
];

const { browser, ctx } = await launch(MOBILE);
const page = await ctx.newPage();
const greske = [];
page.on("console", (m) => { if (m.type() === "error") greske.push(m.text()); });

for (const [ruta, ime] of rute) {
  const res = await page.goto(BASE + ruta, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  const a = await auditScreen(page);
  const naslov = await page.title();
  const h1 = await page.locator("h1").first().innerText().catch(() => "(nema h1)");
  const tekst = (await page.locator("body").innerText()).replace(/\s+/g, " ").trim();
  await shot(page, `mob-${ime}`);
  console.log(JSON.stringify({
    ruta, status: res?.status(), naslov, h1,
    duzinaTeksta: tekst.length,
    prelivanje: a.overflowPx, malihMeta: a.small.length,
    male: a.small.slice(0, 6),
    pocetakTeksta: tekst.slice(0, 180),
  }, null, 1));
}
console.log("KONZOLNE GREŠKE:", JSON.stringify(greske, null, 1));
await browser.close();
