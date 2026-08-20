import { launch, shot, BASE, MOBILE } from "./drive.mjs";
import { signIn } from "./prijava.mjs";
import pg from "pg";
const db = new pg.Client({ connectionString: "postgresql://postgres:postgres@127.0.0.1:54322/postgres" });
await db.connect();
const say=(k,v)=>console.log(`${k}: ${v}`);
const { browser, ctx } = await launch(MOBILE);
const page = await ctx.newPage();
await signIn(page);
await page.waitForTimeout(600);

async function dogadjaji(klijent) {
  const r = await db.query(`select e.from_status, e.to_status, e.actor_type, e.device_id is not null as ima_uredjaj,
      to_char(e.created_at,'HH24:MI:SS') as kad
    from appointment_events e join appointments a on a.id=e.appointment_id
    join clients c on c.id=a.client_id where c.name=$1 order by e.created_at`, [klijent]);
  return r.rows;
}
say("PRE promene — događaji za 'Ana Anić'", JSON.stringify(await dogadjaji("Ana Anić")));

const red = page.locator('button').filter({ hasText: "Ana Anić" }).first();
await red.click(); await page.waitForTimeout(700);
await page.getByRole("button", { name: "Obavljeno" }).first().click();
await page.waitForTimeout(1800);
say("POSLE 'Obavljeno' — događaji", JSON.stringify(await dogadjaji("Ana Anić")));
const t=(await page.locator("body").innerText()).replace(/\s+/g," ");
say("status na ekranu", (t.match(/Ana Anić[^0-9]{0,80}/)||[""])[0]);
await shot(page, "mob-26-obavljeno");

// Istorija
const red2 = page.locator('button').filter({ hasText: "Ana Anić" }).first();
await red2.click(); await page.waitForTimeout(700);
const ist = page.getByRole("button", { name: "Istorija" }).first();
if (await ist.count()) { await ist.click(); await page.waitForTimeout(1500);
  const h=(await page.locator("body").innerText()).replace(/\s+/g," ");
  say("ISTORIJA na ekranu", (h.match(/Istorija.{0,260}/)||[""])[0]);
  await shot(page, "mob-27-istorija");
}
await db.end(); await browser.close();
