import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/db/errors";

export type PushTracking = { attemptId: string; token: string };
type AttemptInput = {
 tenantId: string; appointmentId: string | null; template: string; tag: string;
 target?: { id: string; user_id: string; endpoint: string };
};
export function fingerprint(value: string): string {
 return createHash("sha256").update(value).digest("hex");
}
async function telemetryError(): Promise<void> {
 try { await logError({source:"server",message:"Push dijagnostika nije upisana u bazu."}); } catch { /* Diagnostics cannot interrupt delivery. */ }
}
export async function startPushAttempt(input: AttemptInput): Promise<PushTracking | null> {
 const attemptId=randomUUID();
 const token=randomBytes(32).toString("base64url");
 try {
 const {error}=await createAdminClient().from("push_delivery_attempts").insert({
 id:attemptId,tenant_id:input.tenantId,appointment_id:input.appointmentId,
 subscription_id:input.target?.id??null,user_id:input.target?.user_id??null,
 endpoint_hash:input.target?fingerprint(input.target.endpoint):null,
 provider:input.target?new URL(input.target.endpoint).hostname:null,
 template:input.template,tag:input.tag,receipt_token_hash:input.target?fingerprint(token):null,
 });
 if(error) throw error;
 return {attemptId,token};
 } catch { await telemetryError(); return null; }
}
export async function finishPushAttempt(
 tracking: PushTracking | null, status:"accepted"|"failed"|"expired"|"skipped"|"unavailable",
 options:{httpStatus?:number;errorCode?:string;durationMs?:number}={}
):Promise<void>{
 if(!tracking)return;
 try {
 const {error}=await createAdminClient().from("push_delivery_attempts").update({
 send_status:status,finished_at:new Date().toISOString(),http_status:options.httpStatus??null,
 error_code:options.errorCode??null,duration_ms:options.durationMs??null,
 }).eq("id",tracking.attemptId);
 if(error)throw error;
 } catch {await telemetryError();}
}
export async function recordPushReceipt(input:{
 attemptId:string;token:string;eventId:string;kind:string;clientAt:string;details:Record<string,unknown>
}):Promise<boolean>{
 const {data,error}=await createAdminClient().rpc("record_push_receipt",{
 p_attempt_id:input.attemptId,p_token_hash:fingerprint(input.token),p_event_id:input.eventId,
 p_kind:input.kind,p_client_at:input.clientAt,p_details:input.details,
 });
 if(error)throw new Error("Push receipt storage unavailable");
 return data===true;
}
export async function recordPushClientEvent(input:{
 tenantId:string;userId:string;kind:string;endpoint?:string;details:Record<string,unknown>
}):Promise<void>{
 const {error}=await createAdminClient().rpc("record_push_client_event",{
 p_tenant_id:input.tenantId,p_user_id:input.userId,p_kind:input.kind,
 p_endpoint_hash:input.endpoint?fingerprint(input.endpoint):null,p_details:input.details,
 });
 if(error)throw new Error("Push diagnostics storage unavailable");
}
