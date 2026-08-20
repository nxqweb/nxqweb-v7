import { createClient } from "npm:@supabase/supabase-js@2";

const jsonHeaders={"Content-Type":"application/json"};
const encoder=new TextEncoder();
function response(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:jsonHeaders});}
function secret(name:string){const value=Deno.env.get(name)?.trim();if(!value)throw new Error(`Missing protected secret: ${name}`);return value;}
function hex(bytes:ArrayBuffer){return [...new Uint8Array(bytes)].map((value)=>value.toString(16).padStart(2,"0")).join("");}
function safeEqual(left:string,right:string){if(left.length!==right.length)return false;let diff=0;for(let index=0;index<left.length;index++)diff|=left.charCodeAt(index)^right.charCodeAt(index);return diff===0;}
async function verifyStripeSignature(raw:string,header:string,webhookSecret:string){
  const parts=header.split(",").map((part)=>part.trim().split("=",2));
  const timestamp=parts.find(([key])=>key==="t")?.[1]||"";
  const signatures=parts.filter(([key])=>key==="v1").map(([,value])=>value);
  const seconds=Number(timestamp);
  if(!Number.isFinite(seconds)||Math.abs(Date.now()/1000-seconds)>300||signatures.length===0)return false;
  const key=await crypto.subtle.importKey("raw",encoder.encode(webhookSecret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const expected=hex(await crypto.subtle.sign("HMAC",key,encoder.encode(`${timestamp}.${raw}`)));
  return signatures.some((signature)=>safeEqual(expected,signature));
}

type StripeEvent={id?:string;type?:string;created?:number;livemode?:boolean;data?:{object?:Record<string,unknown>}};
function normalizedType(eventType:string,object:Record<string,unknown>){
  if(eventType==="invoice.paid")return "payment_succeeded";
  if(eventType==="invoice.payment_failed"||eventType==="invoice.payment_action_required")return "payment_failed";
  if(eventType==="customer.subscription.deleted")return "subscription_cancelled";
  if((eventType==="customer.subscription.created"||eventType==="customer.subscription.updated")&&["active","trialing"].includes(String(object.status||"")))return "subscription_active";
  return null;
}

Deno.serve(async(req)=>{
  if(req.method!=="POST")return response({ok:false,error:"Method not allowed."},405);
  if(Deno.env.get("NXQ_BILLING_ENABLED")?.trim().toLowerCase()!=="true")return response({ok:false,error:"Stripe billing is disabled."},503);
  try{
    const raw=await req.text();
    if(encoder.encode(raw).length>262144)throw new Error("Stripe event is too large.");
    const signature=req.headers.get("stripe-signature")||"";
    if(!await verifyStripeSignature(raw,signature,secret("STRIPE_WEBHOOK_SECRET")))return response({ok:false,error:"Invalid Stripe signature."},401);
    const event=JSON.parse(raw) as StripeEvent;
    const object=event.data?.object||{};
    const eventId=String(event.id||"").slice(0,180);
    const eventType=String(event.type||"").slice(0,120);
    const createdSeconds=Number(event.created);
    const providerCustomerId=String(object.customer||"").slice(0,180);
    const mappedType=normalizedType(eventType,object);
    if(!eventId||!providerCustomerId)throw new Error("Stripe event identity is incomplete.");
    if(!Number.isFinite(createdSeconds)||createdSeconds<=0||Math.abs(Date.now()/1000-createdSeconds)>31536000)throw new Error("Stripe event creation time is invalid or outside the replay window.");
    if(event.livemode&&Deno.env.get("NXQ_STRIPE_LIVE_MODE_ENABLED")?.trim().toLowerCase()!=="true")throw new Error("Live-mode Stripe events are disabled.");
    if(!mappedType)return response({ok:true,ignored:true,event_type:eventType},202);

    const admin=createClient(secret("SUPABASE_URL"),secret("SUPABASE_SERVICE_ROLE_KEY"),{auth:{persistSession:false}});
    const link=await admin.from("billing_provider_customer_links").select("client_id,status").eq("provider_key","stripe").eq("provider_customer_id",providerCustomerId).eq("status","active").maybeSingle();
    if(link.error||!link.data)throw new Error("Stripe customer is not linked to an active NXQ client.");
    const client=await admin.from("clients").select("id,qa_only").eq("id",link.data.client_id).single();
    if(client.error||!client.data)throw new Error("Linked NXQ client was not found.");
    if(client.data.qa_only)throw new Error("Billing artifacts are forbidden for QA-only clients.");

    const existing=await admin.from("billing_provider_events").select("id").eq("provider_key","stripe").eq("provider_event_id",eventId).maybeSingle();
    let recordId=existing.data?.id as string|undefined;
    if(!recordId){
      const amountRaw=object.amount_paid??object.amount_due;
      const amount=typeof amountRaw==="number"?amountRaw/100:null;
      const inserted=await admin.from("billing_provider_events").insert({
        provider_key:"stripe",provider_event_id:eventId,provider_customer_id:providerCustomerId,
        client_id:client.data.id,event_type:mappedType,amount,currency:typeof object.currency==="string"?object.currency.toUpperCase():null,
        occurred_at:new Date(createdSeconds*1000).toISOString(),
        normalized_payload:{stripe_event_type:eventType,livemode:Boolean(event.livemode),object_id:String(object.id||"").slice(0,180)}
      }).select("id").single();
      if(inserted.error)throw new Error(`Stripe event insert failed: ${inserted.error.message}`);
      recordId=inserted.data.id;
    }
    const applied=await admin.rpc("apply_verified_billing_provider_event",{target_event_id:recordId});
    if(applied.error)throw new Error(`Stripe event apply failed: ${applied.error.message}`);
    await admin.rpc("record_worker_heartbeat",{target_worker_key:"ingest-stripe-webhook",target_execution_target:"stripe",target_status:"healthy",target_metadata:{signature_verified:true,server_mapped_customer:true,ordered_event_apply:true,livemode:Boolean(event.livemode)},target_last_error:null});
    return response({ok:true,event_id:recordId,idempotent:Boolean(existing.data)});
  }catch(error){return response({ok:false,error:error instanceof Error?error.message:"Unknown Stripe webhook failure."},400);}
});
