export function reportPushInteraction(kind:string,extra:Record<string,unknown>={}):void{
 // Only notification controls call this helper; no generic click tracking.
 const details={
 permission:typeof Notification!=="undefined"?Notification.permission:"unsupported",
 userAgent:navigator.userAgent.slice(0,512),online:navigator.onLine,
 standalone:window.matchMedia("(display-mode: standalone)").matches,
 ...extra,
 };
 void fetch("/api/push/diagnostics",{method:"POST",headers:{"Content-Type":"application/json"},
 body:JSON.stringify({kind,details}),keepalive:true}).catch(()=>{});
}
