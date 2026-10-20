import { receiptSchema } from "@/lib/domain/push-receipt";
import { recordPushReceipt } from "@/lib/db/push-diagnostics";
export const runtime="nodejs";
export async function POST(request:Request):Promise<Response>{
 // This capability endpoint deliberately works without a login cookie.
 const declared=Number(request.headers.get("content-length")??0);
 if(declared>8192)return new Response(null,{status:413});
 let text:string;
 try {
 const reader=request.body?.getReader();
 if(!reader)return new Response(null,{status:400});
 const chunks:Uint8Array[]=[];let length=0;
 while(true){
 const {value,done}=await reader.read();if(done)break;
 length+=value.byteLength;if(length>8192){await reader.cancel();return new Response(null,{status:413});}
 chunks.push(value);
 }
 const bytes=new Uint8Array(length);let offset=0;
 for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 text=new TextDecoder().decode(bytes);
 }catch{return new Response(null,{status:400});}
 let parsed;
 try{parsed=receiptSchema.safeParse(JSON.parse(text));}catch{return new Response(null,{status:400});}
 if(!parsed.success)return new Response(null,{status:400});
 try {
 const ok=await recordPushReceipt(parsed.data);
 return new Response(null,{status:ok?204:403,headers:{"Cache-Control":"no-store"}});
 }catch{return new Response(null,{status:503,headers:{"Cache-Control":"no-store"}});}
}
