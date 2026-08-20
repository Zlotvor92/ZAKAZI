// Stvarna dodirna zona, ne pravougaonik samog elementa: broji se i `::after`
// koji širi metu, i `label` koji aktivira kvačicu unutar sebe.
import { launch, BASE, MOBILE } from "./drive.mjs";
import { signIn } from "./prijava.mjs";

const AUDIT = `(() => {
  const AKTIVIRA = (el, cilj) => {
    // Klik na el aktivira cilj ako je el sam cilj, njegov potomak,
    // ili label koji ga pokriva.
    if (!el) return false;
    if (el === cilj || cilj.contains(el) || el.contains(cilj)) return true;
    const lab = el.closest("label");
    return !!lab && (lab.contains(cilj) || lab.control === cilj);
  };
  const male = [];
  for (const cilj of document.querySelectorAll('button,a,input,select,textarea,[role="button"]')) {
    const r = cilj.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const s = getComputedStyle(cilj);
    if (s.visibility==='hidden'||s.display==='none'||s.opacity==='0') continue;
    if (cilj.type==='file'||cilj.type==='hidden') continue;
    const cx = r.left + r.width/2, cy = r.top + r.height/2;
    // Mete pri samoj ivici ekrana se preskaču: sonda bi im ivicu prozora
    // pročitala kao kraj dodirne zone i prijavila lažno malu metu.
    if (cy < 26 || cy > innerHeight - 26) continue;
    // Koliko se daleko od centra klik i dalje računa kao pogodak?
    const doseg = (dx, dy) => {
      let k = 0;
      for (let d = 1; d <= 24; d++) {
        const x = cx + dx*d, y = cy + dy*d;
        if (x<0||y<0||x>innerWidth||y>innerHeight) break;
        if (!AKTIVIRA(document.elementFromPoint(x,y), cilj)) break;
        k = d;
      }
      return k;
    };
    const visina = doseg(0,-1) + doseg(0,1) + 1;
    const sirina = doseg(-1,0) + doseg(1,0) + 1;
    if (visina < 44 || sirina < 44) {
      male.push({ tag: cilj.tagName.toLowerCase(), tip: cilj.type||'',
        t: (cilj.innerText||cilj.value||cilj.getAttribute('aria-label')||'').trim().slice(0,26),
        w: sirina, h: visina });
    }
  }
  return male;
})()`;

const { browser, ctx } = await launch(MOBILE);
const page = await ctx.newPage();
let ukupno = 0;
async function pregled(url, tag) {
  await page.goto(BASE+url, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  // Skroluj kroz stranu da se izmere i mete ispod preloma.
  const svi = [];
  const visina = await page.evaluate("document.documentElement.scrollHeight");
  for (let y = 0; y < visina; y += 500) {
    await page.evaluate(`scrollTo(0, ${y})`); await page.waitForTimeout(160);
    for (const m of await page.evaluate(AUDIT))
      if (!svi.some(x => x.tag===m.tag && x.t===m.t && x.w===m.w && x.h===m.h)) svi.push(m);
  }
  ukupno += svi.length;
  console.log(`${tag} ${url} → meta ispod 44px: ${svi.length}`);
  for (const m of svi.slice(0,5)) console.log(`     ${m.w}×${m.h}  <${m.tag}${m.tip?' '+m.tip:''}> "${m.t}"`);
}
for (const u of ["/","/studio-milica","/studio-milica/otkazi"]) await pregled(u,"[javno]");
await signIn(page);
for (const u of ["/dashboard","/dashboard/podesavanja","/dashboard/termin/novi","/admin"]) await pregled(u,"[prijavljen]");
console.log(`\nUKUPNO meta ispod 44px (stvarna dodirna zona): ${ukupno}`);
await browser.close();
