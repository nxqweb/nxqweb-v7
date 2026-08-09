import { createClient } from "npm:@supabase/supabase-js@2";

type BillingEvent={provider_key?:unknown;provider_event_id?:unknown;provider_customer_id?:unknown;event_type?:unknown;amount?:unknown;currency?:unknown;occurred_at?:unknown;normalized_payload?:unknown};
const headers={"Content-Type":"application/json"};
function secret(name:string){const v=Deno.env.get(name)?.trim();if(!v)throw new Error(`Missing protected secret: ${name}`);return v;}
function response(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers});}
function text(v:unknown,max:number){return typeof v==="string"?v.trim().slice(0,max):"";}
function payloadSize(value:unknown){try{return new TextEncoder().encode(JSON.stringify(value??{})).length;}catch{return Number.MAX_SAFE_INTEGER;}}

Deno.serve(async(req)=>{
  if(req.method!=="POST")return response({ok:false,error:"Method not allowed."},405);
  if(req.headers.get("x-nxq-billing-adapter-token")!==secret("NXQ_BILLING_ADAPTER_TOKEN"))return response({ok:false,error:"Unauthorized."},401);
  try{
    const body=await req.json() as BillingEvent;
    const providerKey=text(body.provider_key,80);
    const providerEventId=text(body.provider_event_id,180);
    const providerCustomerId=text(body.provider_customer_id,180);
    const eventType=text(body.event_type,80);
    const currency=text(body.currency,3).toUpperCase();
    if(!providerKey||!providerEventId||!providerCustomerId)throw new Error("Provider key, event id, and provider customer id are required.");
    if(!/^[a-z0-9][a-z0-9_-]{1,79}$/i.test(providerKey))throw new Error("Invalid provider key.");
    if(!["payment_succeeded","payment_failed","subscription_cancelled","subscription_active"].includes(eventType))throw new Error("Unsupported normalized billing event type.");
    const occurredAt=new Date(String(body.occurred_at||""));
    if(Number.isNaN(occurredAt.valueOf()))throw new Error("Valid occurred_at timestamp required.");
    const now=Date.now();
    if(occurredAt.valueOf()>now+5*60*1000)throw new Error("occurred_at is too far in the future.");
    if(occurredAt.valueOf()<now-365*24*60*60*1000)throw new Error("occurred_at is outside the accepted history window.");
    const amount=body.amount==null?null:Number(body.amount);
    if(amount!=null&&(!Number.isFinite(amount)||amount<0||amount>1000000))throw new Error("Invalid amount.");
    if(amount!=null&&!/^[A-Z]{3}$/.test(currency))throw new Error("A three-letter currency code is required when amount is present.");
    if(payloadSize(body.normalized_payload)>32768)throw new Error("Normalized billing payload is too large.");

    const admin=createClient(secret("SUPABASE_URL"),secret("SUPABASE_SERVICE_ROLE_KEY"),{auth:{persistSession:false}});
    const provider=await admin.from("nxq_provider_connections").select("id,status,provider_category").eq("provider_key",providerKey).eq("provider_category","payments").in("status",["configured","healthy","degraded"]).limit(1).maybeSingle();
    if(provider.error||!provider.data)throw new Error("Billing provider is not registered and enabled.");

    const link=await admin.from("billing_provider_customer_links").select("client_id,status").eq("provider_key",providerKey).eq("provider_customer_id",providerCustomerId).eq("status","active").maybeSingle();
    if(link.error||!link.data)throw new Error("Provider customer is not linked to an active NXQ client.");
    const clientId=String(link.data.client_id);

    const existing=await admin.from("billing_provider_events").select("id,applied,ignored,ignore_reason").eq("provider_key",providerKey).eq("provider_event_id",providerEventId).maybeSingle();
    let eventId=existing.data?.id as string|undefined;
    if(!eventId){
      const insert=await admin.from("billing_provider_events").insert({
        provider_key:providerKey,
        provider_event_id:providerEventId,
        provider_customer_id:providerCustomerId,
        client_id:clientId,
        event_type:eventType,
        amount,
        currency:currency||null,
        occurred_at:occurredAt.toISOString(),
        normalized_payload:body.normalized_payload&&typeof body.normalized_payload==="object"?body.normalized_payload:{},
      }).select("id").single();
      if(insert.error)throw new Error(`Billing event insert failed: ${insert.error.message}`);
      eventId=insert.data.id;
    }

    const applied=await admin.rpc("apply_verified_billing_provider_event",{target_event_id:eventId});
    if(applied.error)throw new Error(`Billing event apply failed: ${applied.error.message}`);
    await admin.rpc("record_worker_heartbeat",{
      target_worker_key:"ingest-billing-provider-event",
      target_execution_target:"provider",
      target_status:"healthy",
      target_metadata:{provider_key:providerKey,provider_connection_id:provider.data.id,last_event_at:new Date().toISOString(),server_mapped_customer:true,ordered_event_apply:true},
      target_last_error:null,
    });
    return response({ok:true,event_id:eventId,idempotent:Boolean(existing.data),client_resolution:"provider_customer_link",result:applied.data});
  }catch(error){
    return response({ok:false,error:error instanceof Error?error.message:"Unknown billing event failure."},400);
  }
});