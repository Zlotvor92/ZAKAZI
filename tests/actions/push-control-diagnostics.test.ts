import {beforeEach,describe,it,expect,vi} from "vitest";
const m=vi.hoisted(()=>({user:vi.fn(),tenant:vi.fn(),record:vi.fn()}));
vi.mock("@/lib/db/push-diagnostics",()=>({recordPushClientEvent:m.record}));
vi.mock("@/lib/db/tenants",()=>({getCurrentTenant:m.tenant}));
vi.mock("@/lib/tenant",()=>({selectedTenantId:async()=>"t"}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({auth:{getUser:m.user}})}));
import {POST} from "@/app/api/push/diagnostics/route";
const body={kind:"test_clicked",details:{permission:"granted",userAgent:"test",online:true,standalone:true}};
function req(origin="https://app.test"){return new Request("https://app.test/api/push/diagnostics",{method:"POST",headers:{origin},body:JSON.stringify(body)});}
beforeEach(()=>{m.record.mockReset();m.user.mockResolvedValue({data:{user:{id:"u"}}});m.tenant.mockResolvedValue({id:"t"});});
describe("notification control diagnostics",()=>{
it("derives the member and salon from the authenticated session",async()=>{expect((await POST(req())).status).toBe(204);expect(m.record).toHaveBeenCalledWith({tenantId:"t",userId:"u",...body});});
it("does not accept cross-origin or signed-out writes",async()=>{
expect((await POST(req("https://other.test"))).status).toBe(403);
m.user.mockResolvedValue({data:{user:null}});
expect((await POST(req())).status).toBe(401);expect(m.record).not.toHaveBeenCalled();
});
});
