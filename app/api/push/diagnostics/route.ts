import { z } from "zod";
import { getCurrentTenant } from "@/lib/db/tenants";
import { selectedTenantId } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { recordPushClientEvent } from "@/lib/db/push-diagnostics";
export const runtime="nodejs";
const schema=z.object({
 kind:z.enum(["enable_clicked","disable_clicked","test_clicked","permission_result","subscription_error","subscription_saved","subscription_removed","test_result","browser_state","worker_registered","check_result"]),
 details:z.object({
 permission:z.string().max(20),userAgent:z.string().max(512),online:z.boolean(),
 standalone:z.boolean(),errorName:z.string().max(80).optional(),result:z.string().max(80).optional(),
 }).strict(),
}).strict();
export async function POST(request:Request):Promise<Response>{
 try{
 // Reject cross-origin requests; a logged-in membership determines the salon.
 const origin=request.headers.get("origin");
 if(!origin||origin!==new URL(request.url).origin)return new Response(null,{status:403});
 if(Number(request.headers.get("content-length")??0)>4096)return new Response(null,{status:413});
 const reader=request.body?.getReader();
 if(!reader)return new Response(null,{status:400});
 const chunks:Uint8Array[]=[];let length=0;
 while(true){
 const {value,done}=await reader.read();if(done)break;
 length+=value.byteLength;if(length>4096){await reader.cancel();return new Response(null,{status:413});}
 chunks.push(value);
 }
 const bytes=new Uint8Array(length);let offset=0;
 for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 const raw=new TextDecoder().decode(bytes);
 const parsed=schema.safeParse(JSON.parse(raw));
 if(!parsed.success)return new Response(null,{status:400});
 const supabase=await createClient();const {data}=await supabase.auth.getUser();
 if(!data.user)return new Response(null,{status:401});
 const tenant=await getCurrentTenant(await selectedTenantId());
 if(!tenant)return new Response(null,{status:403});
 await recordPushClientEvent({tenantId:tenant.id,userId:data.user.id,...parsed.data});
 return new Response(null,{status:204});
 }catch{return new Response(null,{status:503});}
}
