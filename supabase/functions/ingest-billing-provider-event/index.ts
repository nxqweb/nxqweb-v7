import { createClient } from "npm:@supabase/supabase-js@2";

type BillingEvent={provider_key?:unknown;provider_event_id?:unknown;client_id?:unknown;event_type?:unknown;amount?:unknown;currency?:unknown;occurred_at?:unknown;normalized_payload?:unknown};
const headers={"Content-Type":"application/json"};
function secret(name:string){const v=Deno.env.get(name)?.trim();if(!v)throw new Error(`Missing protected secret: ${name}`);return v;}
function response(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers});}
function text(v:unknown,max:number){return typeof v==="string"?v.trim().slice(0,max):"";}
Deno.serve(async(req)=>{
  if(req.method!=="POST")return response({ok:false,error:"Method not allowed."},405);
  if(req.headers.get("x-nxq-billing-adapter-token")!==secret("NXQ_BILLING_ADAPTER_TOKEN"))return response({ok:false,error:"Unauthorized."},401);
  try{
    const body=await req.json() as BillingEvent;
    const providerKey=text(body.provider_key,80);const providerEventId=text(body.provider_event_id,180);const clientId=text(body.client_id,80);const eventType=text(body.event_type,80);const currency=text(body.currency,8).toUpperCase();
    if(!providerKey||!providerEventId||!clientId)throw new Error("Provider key, event id, and client id are required.");
    if(!["payment_succeeded","payment_failed","subscription_cancelled","subscription_active"].includes(eventType))throw new Error("Unsupported normalized billing event type.");
    const occurredAt=new Date(String(body.occurred_at||""));if(Number.isNaN(occurredAt.valueOf()))throw new Error("Valid occurred_at timestamp required.");
    const amount=body.amount==null?null:Number(body.amount);if(amount!=null&&(!Number.isFinite(amount)||amount<0||amount>1000000))throw new Error("Invalid amount.");
    const admin=createClient(secret("SUPABASE_URL"),secret("SUPABASE_SERVICE_ROLE_KEY"),{auth:{persistSession:false}});
    const client=await admin.from("clients").select("id").eq("id",clientId).maybeSingle();if(client.error||!client.data)throw new Error("Billing client not found.");
    const existing=await admin.from("billing_provider_events").select("id,applied").eq("provider_key",providerKey).eq("provider_event_id",providerEventId).maybeSingle();
    let eventId=existing.data?.id as string|undefined;
    if(!eventId){const insert=await admin.from("billing_provider_events").insert({provider_key:providerKey,provider_event_id:providerEventId,client_id:clientId,event_type:eventType,amount,currency:currency||null,occurred_at:occurredAt.toISOString(),normalized_payload:body.normalized_payload&&typeof body.normalized_payload==="object"?body.normalized_payload:{}}).select("id").single();if(insert.error)throw new Error(`Billing event insert failed: ${insert.error.message}`);eventId=insert.data.id;}
    const applied=await admin.rpc("apply_verified_billing_provider_event",{target_event_id:eventId});if(applied.error)throw new Error(`Billing event apply failed: ${applied.error.message}`);
    return response({ok:true,event_id:eventId,idempotent:Boolean(existing.data),result:applied.data});
  }catch(error){return response({ok:false,error:error instanceof Error?error.message:"Unknown billing event failure."},400);}
});