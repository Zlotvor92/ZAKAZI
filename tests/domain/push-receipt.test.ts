import {describe,it,expect} from "vitest";
import {receiptSchema} from "@/lib/domain/push-receipt";
const valid={attemptId:"f3c86798-64a2-4f9d-8e95-b70bf6a80bb1",token:"x".repeat(43),
eventId:"c95676df-f098-46a9-9bdf-9f4c812ea531",kind:"received",clientAt:"2026-10-20T16:00:00Z",
details:{workerVersion:"v1",permission:"granted",userAgent:"test"}};
describe("bounded push receipts",()=>{
it("accepts lifecycle events",()=>{for(const kind of ["received","show_resolved","show_failed","clicked","closed","click_opened","click_failed"])expect(receiptSchema.safeParse({...valid,kind}).success).toBe(true);});
it("rejects guessed tokens, arbitrary data and oversized details",()=>{
for(const value of [{...valid,token:"bad"},{...valid,kind:"admin"},{...valid,details:{...valid.details,userAgent:"x".repeat(513)}},{...valid,tenantId:"forged"}])
expect(receiptSchema.safeParse(value).success).toBe(false);
});
});
