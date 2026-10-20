import {createHash,randomUUID} from "node:crypto";
import {test,expect} from "@playwright/test";
import pg from "pg";
const DATABASE_URL=process.env["DATABASE_URL"]??"postgresql://postgres:postgres@127.0.0.1:54322/postgres";
test("background receipt reaches the database without a login cookie",async({request})=>{
 const db=new pg.Client({connectionString:DATABASE_URL});await db.connect();
 const attemptId=randomUUID();const eventId=randomUUID();const token="R".repeat(43);
 try{
 const tenant=(await db.query("select id from tenants where slug='studio-milica'")).rows[0]!.id;
 await db.query("insert into push_delivery_attempts(id,tenant_id,template,receipt_token_hash) values($1,$2,'test',$3)",[attemptId,tenant,createHash("sha256").update(token).digest("hex")]);
 const receipt={attemptId,eventId,token,kind:"clicked",clientAt:new Date().toISOString(),details:{workerVersion:"e2e",permission:"granted",userAgent:"test"}};
 expect((await request.post("/api/push/receipt",{data:{...receipt,token:"X".repeat(43)}})).status()).toBe(403);
 expect((await request.post("/api/push/receipt",{data:receipt})).status()).toBe(204);
 expect((await request.post("/api/push/receipt",{data:receipt})).status()).toBe(204);
 const result=(await db.query("select device_status,click_count from push_delivery_diagnostics where id=$1",[attemptId])).rows[0]!;
 expect(result.device_status).toBe("click_confirmed");expect(result.click_count).toBe("1");
 }finally{
 await db.query("delete from push_delivery_attempts where id=$1",[attemptId]);
 await db.end();
 }
});
