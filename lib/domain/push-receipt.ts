import { z } from "zod";
export const receiptSchema=z.object({
 attemptId:z.uuid(),token:z.string().regex(/^[A-Za-z0-9_-]{43}$/),eventId:z.uuid(),
 kind:z.enum(["received","show_resolved","show_failed","clicked","closed","click_opened","click_failed","payload_invalid"]),
 clientAt:z.iso.datetime({offset:true}),
 details:z.object({
 workerVersion:z.string().max(80),permission:z.string().max(20),
 userAgent:z.string().max(512),errorName:z.string().max(80).optional(),
 action:z.string().max(80).optional(),online:z.boolean().optional(),
 }).strict(),
}).strict();
