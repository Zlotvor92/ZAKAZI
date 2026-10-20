import {beforeEach,describe,it,expect,vi} from "vitest";
const {record}=vi.hoisted(()=>({record:vi.fn()}));
vi.mock("@/lib/db/push-diagnostics",()=>({recordPushReceipt:record}));
import {POST} from "@/app/api/push/receipt/route";
const valid={attemptId:"f3c86798-64a2-4f9d-8e95-b70bf6a80bb1",token:"x".repeat(43),
eventId:"c95676df-f098-46a9-9bdf-9f4c812ea531",kind:"received",clientAt:"2026-10-20T16:00:00Z",
details:{workerVersion:"v1",permission:"granted",userAgent:"test"}};
function request(body:unknown){return new Request("https://app.test/api/push/receipt",{method:"POST",body:JSON.stringify(body)});}
beforeEach(()=>record.mockReset());
describe("push receipt route",()=>{
it("accepts a valid capability without session cookies",async()=>{record.mockResolvedValue(true);expect((await POST(request(valid))).status).toBe(204);expect(record).toHaveBeenCalledWith(valid);});
it("does not acknowledge invalid capabilities",async()=>{record.mockResolvedValue(false);expect((await POST(request(valid))).status).toBe(403);});
it("retries storage failures instead of falsely acknowledging",async()=>{record.mockRejectedValue(new Error("db"));expect((await POST(request(valid))).status).toBe(503);});
it("rejects arbitrary and oversized bodies before storage",async()=>{
expect((await POST(request({...valid,token:"bad"}))).status).toBe(400);
expect((await POST(request({padding:"x".repeat(9000)}))).status).toBe(413);
expect(record).not.toHaveBeenCalled();
});
});
