import {beforeEach,describe,it,expect,vi} from "vitest";
const m=vi.hoisted(()=>({insert:vi.fn(),update:vi.fn(),rpc:vi.fn(),error:vi.fn()}));
vi.mock("@/lib/db/errors",()=>({logError:m.error}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>({
from:()=>({insert:m.insert,update:(data:unknown)=>({eq:async()=>m.update(data)})}),rpc:m.rpc,
})}));
import {startPushAttempt,finishPushAttempt,recordPushReceipt,fingerprint} from "@/lib/db/push-diagnostics";
const input={tenantId:"t",appointmentId:"a",template:"test",tag:"tag",target:{id:"s",user_id:"u",endpoint:"https://fcm.googleapis.com/fcm/send/secret-endpoint"}};
beforeEach(()=>{m.insert.mockReset();m.update.mockReset();m.rpc.mockReset();m.error.mockReset();m.insert.mockResolvedValue({error:null});m.update.mockResolvedValue({error:null});});
describe("push diagnostic storage",()=>{
it("stores fingerprints instead of subscription credentials or receipt secrets",async()=>{
const tracking=await startPushAttempt(input);expect(tracking).not.toBeNull();
const row=m.insert.mock.calls[0]![0];
expect(row.receipt_token_hash).toBe(fingerprint(tracking!.token));expect(JSON.stringify(row)).not.toContain(tracking!.token);
expect(row.endpoint_hash).toBe(fingerprint(input.target.endpoint));expect(JSON.stringify(row)).not.toContain("secret-endpoint");
});
it("telemetry failures are reported but do not reject the send path",async()=>{
m.insert.mockResolvedValue({error:new Error("db")});
expect(await startPushAttempt(input)).toBeNull();expect(m.error).toHaveBeenCalledOnce();
m.update.mockRejectedValue(new Error("db"));
await expect(finishPushAttempt({attemptId:"id",token:"secret"},"accepted")).resolves.toBeUndefined();
});
it("hashes the receipt token before database ingestion",async()=>{
m.rpc.mockResolvedValue({data:true,error:null});
await recordPushReceipt({attemptId:"id",token:"secret",eventId:"event",kind:"clicked",clientAt:"2026-10-20T16:00:00Z",details:{}});
expect(m.rpc.mock.calls[0]![1].p_token_hash).toBe(fingerprint("secret"));
expect(JSON.stringify(m.rpc.mock.calls)).not.toContain('"p_token":"secret"');
});
});
