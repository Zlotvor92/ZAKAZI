import {createHash,randomUUID} from "node:crypto";
import {afterAll,describe,it,expect} from "vitest";
import {asAnon,asServer,asUser,closePool,createTenant,createUser,inSavepoint,withRollback} from "./helpers";
afterAll(closePool);
const token="x".repeat(43);
const hash=createHash("sha256").update(token).digest("hex");
describe("push delivery diagnostics",()=>{
it("keeps per-device receipts deduplicated and preserves device/server times",async()=>{
 await withRollback(async db=>{
 const tenant=await createTenant(db);const id=randomUUID();const event=randomUUID();
 await db.query("insert into push_delivery_attempts(id,tenant_id,template,receipt_token_hash) values($1,$2,'test',$3)",[id,tenant,hash]);
 const receipt=async(h:string,e=event,kind="received")=>asServer(db,async()=>(
 await db.query("select record_push_receipt($1,$2,$3,$4,'2026-10-20T16:00:00Z','{}') as ok",[id,h,e,kind])
 ).rows[0]!.ok);
 expect(await receipt("bad")).toBe(false);
 expect(await receipt(hash)).toBe(true);expect(await receipt(hash)).toBe(true);
 expect((await db.query("select count(*)::int n from push_delivery_events where attempt_id=$1",[id])).rows[0]!.n).toBe(1);
 await receipt(hash,randomUUID(),"clicked");
 await receipt(hash,randomUUID(),"show_resolved");
 const view=(await db.query("select * from push_delivery_diagnostics where id=$1",[id])).rows[0]!;
 expect(view.device_status).toBe("click_confirmed");
 expect(view.click_count).toBe("1");
 expect(new Date(view.device_received_at).toISOString()).toBe("2026-10-20T16:00:00.000Z");
 expect(view.received_reported_at).toBeDefined();
 });
});
it("unconfirmed does not mean undelivered, even when the provider accepted",async()=>{
 await withRollback(async db=>{
 const tenant=await createTenant(db);const id=randomUUID();
 await db.query("insert into push_delivery_attempts(id,tenant_id,template,send_status) values($1,$2,'test','accepted')",[id,tenant]);
 expect((await db.query("select device_status from push_delivery_diagnostics where id=$1",[id])).rows[0]!.device_status).toBe("receipt_unconfirmed");
 });
});
it("tenant members read only their own diagnostics and cannot forge events",async()=>{
 await withRollback(async db=>{
 const a=await createTenant(db);const b=await createTenant(db);const user=await createUser(db,a);
 const id=randomUUID();
 await db.query("insert into push_delivery_attempts(id,tenant_id,template) values($1,$2,'test')",[id,b]);
 await asUser(db,user,async()=>{
 for(const table of ["push_delivery_attempts","push_delivery_diagnostics","push_delivery_events","push_client_events"]){
 expect((await db.query("select count(*)::int n from "+table+" where tenant_id=$1",[b])).rows[0]!.n).toBe(0);
 }
 await expect(inSavepoint(db,()=>db.query("insert into push_client_events(tenant_id,user_id,kind) values($1,$2,'test_clicked')",[a,user]))).rejects.toThrow(/permission denied/);
 await expect(inSavepoint(db,()=>db.query("select record_push_receipt($1,$2,$3,'received',now(),'{}')",[id,hash,randomUUID()]))).rejects.toThrow(/permission denied/);
 });
 await asAnon(db,async()=>{
 await expect(inSavepoint(db,()=>db.query("select * from push_delivery_attempts"))).rejects.toThrow(/permission denied/);
 });
 });
});
it("records control actions only for actual members and keeps failed-display evidence",async()=>{
 await withRollback(async db=>{
 const a=await createTenant(db);const b=await createTenant(db);const user=await createUser(db,a);
 const result=await asServer(db,()=>db.query("select record_push_client_event($1,$2,'test_clicked',null,'{}') as ok",[b,user]));
 expect(result.rows[0]!.ok).toBe(false);
 const id=randomUUID();
 await db.query("insert into push_delivery_attempts(id,tenant_id,template,receipt_token_hash) values($1,$2,'test',$3)",[id,a,hash]);
 await asServer(db,()=>db.query("select record_push_receipt($1,$2,$3,'show_failed',now(),'{\"errorName\":\"NotAllowedError\"}')",[id,hash,randomUUID()]));
 expect((await db.query("select device_status from push_delivery_diagnostics where id=$1",[id])).rows[0]!.device_status).toBe("show_failed");
 });
});
});
