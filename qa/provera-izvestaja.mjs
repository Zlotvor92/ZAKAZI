import { chromium } from "@playwright/test";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
for (const [tema, opts] of [["svetla",{colorScheme:"light"}],["tamna",{colorScheme:"dark"}]]) {
  const ctx = await b.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, ...opts });
  const p = await ctx.newPage();
  const greske = [];
  p.on("console", m => { if (m.type()==="error") greske.push(m.text()); });
  await p.goto("file:///home/user/ZAKAZI/qa/izvestaj.html", { waitUntil:"networkidle" });
  await p.waitForTimeout(1200);
  const r = await p.evaluate(() => {
    const cv=document.createElement("canvas");cv.width=cv.height=1;
    const cx=cv.getContext("2d",{willReadFrequently:true});
    const rgb=c=>{cx.clearRect(0,0,1,1);cx.fillStyle="#000";cx.fillStyle=c;cx.fillRect(0,0,1,1);const d=cx.getImageData(0,0,1,1).data;return [d[0],d[1],d[2]];};
    const ch=v=>{v/=255;return v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4;};
    const lum=([r,g,b])=>0.2126*ch(r)+0.7152*ch(g)+0.0722*ch(b);
    const rat=(a,b)=>{const [x,y]=[lum(a),lum(b)].sort((p,q)=>q-p);return (x+0.05)/(y+0.05);};
    const pod=el=>{let n=el;while(n&&n!==document.documentElement){const c=getComputedStyle(n).backgroundColor;
      if(c!=="rgba(0, 0, 0, 0)"&&c!=="transparent")return rgb(c);n=n.parentElement;}return rgb("#fff");};
    const pali=[];
    for(const el of document.querySelectorAll("p,span,td,th,li,h1,h2,h3,code,strong,a")){
      const t=(el.innerText||"").trim(); if(!t||el.children.length)continue;
      const s=getComputedStyle(el); const size=parseFloat(s.fontSize);
      const veliki=size>=24||(size>=18.66&&parseInt(s.fontWeight)>=700);
      const o=rat(rgb(s.color),pod(el));
      if(o<(veliki?3:4.5))pali.push({t:t.slice(0,30),px:+size.toFixed(1),o:+o.toFixed(2)});
    }
    const fontovi=[...new Set([...document.querySelectorAll("h1,h2,p,code")].map(e=>getComputedStyle(e).fontFamily.split(",")[0]))];
    return { preliv: document.documentElement.scrollWidth - document.documentElement.clientWidth,
             visina: document.documentElement.scrollHeight,
             body: getComputedStyle(document.body).backgroundColor, fontovi, pali };
  });
  console.log(`\n[${tema}] pozadina=${r.body} preliv=${r.preliv}px visina=${r.visina}px`);
  console.log(`  fontovi: ${r.fontovi.join(" | ")}`);
  console.log(`  ispod WCAG AA: ${r.pali.length}`, r.pali.slice(0,4).map(x=>`${x.o}@${x.px}px "${x.t}"`).join(" ; "));
  console.log(`  konzolne greške: ${greske.length}`);
  await p.screenshot({ path:`/tmp/izv-${tema}.png` });
  await ctx.close();
}
await b.close();
