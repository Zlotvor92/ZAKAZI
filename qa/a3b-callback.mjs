import { launch, shot, BASE, MOBILE } from "./drive.mjs";
import { magicLink } from "./prijava.mjs";
const { browser, ctx } = await launch(MOBILE);
const say = (k, v) => console.log(`${k}: ${v}`);

async function svez() { const p = await ctx.newPage(); await ctx.clearCookies(); return p; }

// Istrošena veza, BEZ sesije: potroši link u jednom prozoru, pa ga otvori u čistom.
const link = await magicLink();
let p = await svez();
await p.goto(link, { waitUntil: "networkidle" });
say("1. prvi put", p.url().replace(BASE, ""));
await p.close();

p = await svez();
await p.goto(link, { waitUntil: "networkidle" });
say("2. ISTROŠENA veza bez sesije ->", p.url().replace(BASE, ""));
say("   tekst", (await p.locator("body").innerText()).replace(/\s+/g," ").slice(0,220));
await shot(p, "mob-12-istrosena-veza");
await p.close();

p = await svez();
await p.goto(`${BASE}/auth/callback?token_hash=deadbeefdeadbeef&type=magiclink`, { waitUntil: "networkidle" });
say("3. IZMENJENA veza ->", p.url().replace(BASE, ""));
say("   tekst", (await p.locator("body").innerText()).replace(/\s+/g," ").slice(0,220));
await p.close();

p = await svez();
await p.goto(`${BASE}/auth/callback`, { waitUntil: "networkidle" });
say("4. BEZ parametara ->", p.url().replace(BASE, ""));
say("   tekst", (await p.locator("body").innerText()).replace(/\s+/g," ").slice(0,220));
await p.close();

p = await svez();
await p.goto(`${BASE}/auth/callback?error=access_denied&error_description=odustao`, { waitUntil: "networkidle" });
say("5. provajder odbio ->", p.url().replace(BASE, ""));
say("   tekst", (await p.locator("body").innerText()).replace(/\s+/g," ").slice(0,220));
await p.close();

// Otvoreno preusmerenje?
p = await svez();
await p.goto(`${BASE}/auth/callback?token_hash=x&type=magiclink&redirect_to=https://zlo.example/`, { waitUntil: "networkidle" });
say("6. pokušaj preusmerenja na tuđi domen ->", p.url());
await browser.close();
