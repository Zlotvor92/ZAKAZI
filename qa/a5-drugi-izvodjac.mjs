import { launch, shot, BASE, MOBILE } from "./drive.mjs";
import { signIn } from "./prijava.mjs";
const { browser, ctx } = await launch(MOBILE);
const page = await ctx.newPage();
const say = (k, v) => console.log(`${k}: ${v}`);
await signIn(page);
await page.goto(`${BASE}/dashboard/podesavanja`, { waitUntil: "networkidle" });

// Sekcija „Ko radi u salonu": polje za novu osobu je poslednje prazno u toj sekciji.
const sec = page.locator("section").filter({ hasText: "Ko radi u salonu" }).first();
say("pre dodavanja — dugmadi u sekciji", (await sec.getByRole("button").allInnerTexts()).join(" | "));
const polja = sec.locator('input[type="text"], input:not([type])');
say("pre dodavanja — broj polja", await polja.count());
const vrednosti = [];
for (let i = 0; i < await polja.count(); i++) vrednosti.push(await polja.nth(i).inputValue());
say("pre dodavanja — vrednosti", JSON.stringify(vrednosti));

// Upiši ime u prazno polje i klikni „Dodaj osobu".
const prazno = polja.last();
await prazno.fill("Jovana");
await sec.getByRole("button", { name: "Dodaj osobu" }).click();
await page.waitForTimeout(1500);
await shot(page, "mob-14-dve-osobe");
const posle = [];
const polja2 = sec.locator('input[type="text"], input:not([type])');
for (let i = 0; i < await polja2.count(); i++) posle.push(await polja2.nth(i).inputValue());
say("posle dodavanja — vrednosti", JSON.stringify(posle));
say("posle dodavanja — dugmad", (await sec.getByRole("button").allInnerTexts()).join(" | "));

// Treća osoba mora da bude odbijena jasnom porukom.
const polja3 = sec.locator('input[type="text"], input:not([type])');
await polja3.last().fill("Treca Osoba");
await sec.getByRole("button", { name: "Dodaj osobu" }).click();
await page.waitForTimeout(1500);
say("treća osoba", (await sec.innerText()).replace(/\s+/g," ").slice(0, 400));
await shot(page, "mob-15-treca-odbijena");
await browser.close();
