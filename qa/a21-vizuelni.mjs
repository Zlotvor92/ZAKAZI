import { launch, shot, BASE, MOBILE, DESKTOP } from "./drive.mjs";
import { signIn } from "./prijava.mjs";

const JAVNE = [["/","pocetna"],["/studio-milica","salon"],["/studio-milica/otkazi","otkazi"],
  ["/politika-privatnosti","privatnost"],["/uslovi-koriscenja","uslovi"]];
const PRIJAVLJENE = [["/dashboard","kalendar"],["/dashboard/podesavanja","podesavanja"],
  ["/dashboard/termin/novi","novi-termin"],["/admin","konzola"]];

const AUDIT = `(() => {
  const male=[], preliv=[];
  for (const el of document.querySelectorAll('button,a,input,select,textarea,[role="button"]')) {
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    const s = getComputedStyle(el);
    if (s.visibility==='hidden'||s.display==='none'||s.opacity==='0') continue;
    if (el.type==='file'||el.type==='hidden') continue;
    if (r.height < 44 || r.width < 44)
      male.push({ tag: el.tagName.toLowerCase(), tip: el.type||'', t:(el.innerText||el.value||el.getAttribute('aria-label')||'').trim().slice(0,26), w:Math.round(r.width), h:Math.round(r.height) });
  }
  for (const el of document.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.right > document.documentElement.clientWidth + 1) preliv.push(el.tagName.toLowerCase()+' ('+Math.round(r.right)+'px)');
  }
  return { preliv: document.documentElement.scrollWidth - document.documentElement.clientWidth,
           izlaze: [...new Set(preliv)].slice(0,4), male };
})()`;

const { browser, ctx } = await launch(MOBILE);
const page = await ctx.newPage();
let ukupnoMalih = 0, ekrana = 0, saPrelivom = 0;
const zbirno = new Map();

async function pregled(url, ime, tag) {
  await page.goto(BASE+url, { waitUntil: "networkidle" }); await page.waitForTimeout(500);
  const a = await page.evaluate(AUDIT);
  ekrana++; ukupnoMalih += a.male.length; if (a.preliv > 0) saPrelivom++;
  for (const m of a.male) { const k = `${m.tag}${m.tip?'['+m.tip+']':''} ${m.w}×${m.h}`; zbirno.set(k,(zbirno.get(k)||0)+1); }
  console.log(`\n${tag} ${url}`);
  console.log(`   vodoravni preliv: ${a.preliv}px ${a.preliv>0?'✗ '+a.izlaze.join(', '):'✓'} | meta ispod 44px: ${a.male.length}`);
  for (const m of a.male.slice(0,4)) console.log(`     ${m.w}×${m.h}  <${m.tag}${m.tip?' '+m.tip:''}> "${m.t}"`);
  await shot(page, `vis-${ime}`);
}

for (const [u,n] of JAVNE) await pregled(u,n,"[javno]");
await signIn(page);
for (const [u,n] of PRIJAVLJENE) await pregled(u,n,"[prijavljen]");

console.log(`\n═══ ZBIRNO (390×844) ═══`);
console.log(`ekrana pregledano: ${ekrana} | sa vodoravnim prelivom: ${saPrelivom} | ukupno meta ispod 44px: ${ukupnoMalih}`);
console.log("najčešće premale mete:");
for (const [k,v] of [...zbirno.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8)) console.log(`   ${v}× ${k}`);
await browser.close();
