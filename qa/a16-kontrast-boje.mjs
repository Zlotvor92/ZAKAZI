import { launch, BASE, MOBILE, shot } from "./drive.mjs";
import pg from "pg";
const db = new pg.Client({ connectionString: "postgresql://postgres:postgres@127.0.0.1:54322/postgres" });
await db.connect();
const { browser, ctx } = await launch(MOBILE);
const page = await ctx.newPage();

const MERI = `(() => {
  const cv=document.createElement("canvas");cv.width=cv.height=1;
  const cx=cv.getContext("2d",{willReadFrequently:true});
  const rgb=c=>{cx.clearRect(0,0,1,1);cx.fillStyle="#000";cx.fillStyle=c;cx.fillRect(0,0,1,1);const d=cx.getImageData(0,0,1,1).data;return [d[0],d[1],d[2]];};
  const ch=v=>{v/=255;return v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4;};
  const lum=([r,g,b])=>0.2126*ch(r)+0.7152*ch(g)+0.0722*ch(b);
  const rat=(a,b)=>{const [x,y]=[lum(a),lum(b)].sort((p,q)=>q-p);return (x+0.05)/(y+0.05);};
  const podloga=el=>{let n=el;while(n&&n!==document.documentElement){const c=getComputedStyle(n).backgroundColor;
    if(c!=="rgba(0, 0, 0, 0)"&&c!=="transparent")return rgb(c);n=n.parentElement;}return rgb("#fff");};
  const pali=[];
  for(const el of document.querySelectorAll("p,span,div,button,a,h1,h2,h3,label,li")){
    const t=(el.innerText||"").trim(); if(!t||el.children.length)continue;
    const s=getComputedStyle(el); const size=parseFloat(s.fontSize);
    const veliki=size>=24||(size>=18.66&&parseInt(s.fontWeight)>=700); const prag=veliki?3:4.5;
    const o=rat(rgb(s.color),podloga(el));
    if(o<prag)pali.push({t:t.slice(0,34),px:size,o:+o.toFixed(2),prag});
  }
  return {bg:rgb(getComputedStyle(document.body).backgroundColor),pali};
})()`;

const slucajevi = [
  ["#ffffff", "#4d213c", "vrlo svetla pozadina"],
  ["#999999", "#333333", "SREDNJI TON (najgori slučaj po računu)"],
  ["#777777", "#222222", "srednji ton 2"],
  ["#b8860b", "#4d213c", "zlatna (b8860b)"],
  ["#111111", "#e8c8d8", "vrlo tamna pozadina"],
  ["#ffd1dc", "#800020", "pastelno roze (tipičan izbor salona)"],
];
for (const [bg, pr, opis] of slucajevi) {
  await db.query("update tenants set brand_background=$1, brand_primary=$2, brand_accent=$2 where slug='studio-milica'", [bg, pr]);
  await page.goto(`${BASE}/studio-milica`, { waitUntil: "networkidle" });
  await page.waitForTimeout(350);
  const r = await page.evaluate(MERI);
  console.log(`\n### ${opis}  pozadina=${bg} primarna=${pr}`);
  console.log(`  stvarna pozadina: rgb(${r.bg.join(",")}) | ispod AA: ${r.pali.length}`);
  for (const x of r.pali.slice(0,5)) console.log(`    ${x.o} (prag ${x.prag}, ${x.px}px) "${x.t}"`);
  await shot(page, `mob-31-boje-${bg.slice(1)}`);
}
await db.query("update tenants set brand_background=null, brand_primary=null, brand_accent=null where slug='studio-milica'");
await db.end(); await browser.close();
