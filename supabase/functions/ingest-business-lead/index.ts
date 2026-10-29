import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { requirePublicHttpsUrl } from "../_shared/outbound-security.ts";

type Payload={form_key?:string;name?:string;email?:string;phone?:string;service?:string;message?:string;service_area?:string;utm?:Record<string,unknown>;company_website?:string;challenge_token?:string};
type FormRow={id:string;client_id:string;project_id:string;status:string;allowed_origins:string[]|null;allowed_service_keys:string[]|null;max_message_length:number;hourly_limit:number;require_challenge:boolean;challenge_provider:string|null};
type QuotaReservation={allowed?:boolean;retry_after_seconds?:number};
type ChallengeDecision={allowed:boolean;mode:"provider_verified"|"not_required"|"staging_rate_limit_honeypot"|"blocked"};
type TurnstileResponse={success?:boolean;hostname?:string;"error-codes"?:string[]};
const MAX_REQUEST_BYTES=32768;
const STAGING_ENVIRONMENTS=new Set(["staging","stage","development","dev","test","qa"]);
function requestOrigin(req:Request){const origin=(req.headers.get("origin")||req.headers.get("x-nxq-form-origin")||"").trim();return /^https:\/\/[^\s/$.?#].*$/i.test(origin)?origin:"";}
function cors(origin:string){return {"Content-Type":"application/json","Access-Control-Allow-Origin":origin||"https://invalid.nxq.local","Access-Control-Allow-Headers":"content-type,x-nxq-form-origin","Access-Control-Allow-Methods":"POST,OPTIONS","Vary":"Origin"};}
function secret(name:string){const v=Deno.env.get(name)?.trim();if(!v)throw new Error(`Missing protected secret: ${name}`);return v;}
function response(body:unknown,status=200,origin=""){return new Response(JSON.stringify(body),{status,headers:cors(origin)});}
function clean(value:unknown,max:number){return typeof value==="string"?value.trim().slice(0,max):"";}
async function sha256(value:string){const bytes=new TextEncoder().encode(value);const digest=await crypto.subtle.digest("SHA-256",bytes);return Array.from(new Uint8Array(digest)).map((b)=>b.toString(16).padStart(2,"0")).join("");}
async function reserveLeadQuota(admin:SupabaseClient,form:FormRow,fingerprint:string){
  const totalIdentity=await sha256(`lead-form:${form.id}`);
  const total=await admin.rpc("nxq_reserve_ingress_capacity",{target_scope_key:`lead-form:${form.id}`,target_operation_key:"lead_total_hourly",target_identity_hash:totalIdentity,target_units:1,target_limit_units:form.hourly_limit,target_window_seconds:3600});
  if(total.error)throw new Error(`Lead quota reservation failed: ${total.error.message}`);
  if(!(total.data as QuotaReservation|null)?.allowed)return total.data as QuotaReservation;
  const perFingerprint=await admin.rpc("nxq_reserve_ingress_capacity",{target_scope_key:`lead-form:${form.id}`,target_operation_key:"lead_fingerprint_hourly",target_identity_hash:fingerprint,target_units:1,target_limit_units:Math.min(8,form.hourly_limit),target_window_seconds:3600});
  if(perFingerprint.error)throw new Error(`Lead quota reservation failed: ${perFingerprint.error.message}`);
  return perFingerprint.data as QuotaReservation;
}
function emailOkay(v:string){return !v||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);}
function phoneOkay(v:string){return !v||/^[+()\-\s\d.]{7,32}$/.test(v);}
function urgency(message:string){const m=message.toLowerCase();if(/(life safety|gas leak|fire|electrical fire|immediate danger)/.test(m))return "emergency";if(/(emergency|urgent|asap|right now|today|storm damage|no heat|no ac|leaking|flood)/.test(m))return "urgent";return "normal";}
function score(p:Payload){let n=25;if(clean(p.email,200))n+=15;if(clean(p.phone,40))n+=15;if(clean(p.service,120))n+=15;if(clean(p.message,4000).length>40)n+=15;if(clean(p.service_area,300))n+=10;return Math.min(100,n);}
function stagingFallbackAllowed(){return STAGING_ENVIRONMENTS.has((Deno.env.get("NXQ_RUNTIME_ENVIRONMENT")||"").trim().toLowerCase());}
function turnstileProvider(value:string|null){return ["cloudflare_turnstile","turnstile"].includes((value||"").trim().toLowerCase());}
async function verifyChallenge(form:FormRow,token:string,origin:string,remoteIp:string):Promise<ChallengeDecision>{
  const endpoint=Deno.env.get("NXQ_LEAD_CHALLENGE_ENDPOINT")?.trim();const auth=Deno.env.get("NXQ_LEAD_CHALLENGE_TOKEN")?.trim();
  if(!endpoint||!auth){
    if(!form.require_challenge&&stagingFallbackAllowed())return {allowed:true,mode:"staging_rate_limit_honeypot"};
    return {allowed:false,mode:"blocked"};
  }
  if(!form.require_challenge)return {allowed:true,mode:"not_required"};
  if(!token)return {allowed:false,mode:"blocked"};
  const safeEndpoint=requirePublicHttpsUrl(endpoint,"Lead challenge endpoint");
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),8000);
  try{
    if(turnstileProvider(form.challenge_provider)){
      const requestBody:Record<string,string>={secret:auth,response:token};
      if(remoteIp)requestBody.remoteip=remoteIp;
      const res=await fetch(safeEndpoint,{method:"POST",redirect:"error",headers:{"Content-Type":"application/json"},body:JSON.stringify(requestBody),signal:controller.signal});
      if(!res.ok)return {allowed:false,mode:"blocked"};
      const body=await res.json().catch(()=>null) as TurnstileResponse|null;
      const requestHostname=new URL(origin).hostname.toLowerCase();
      const verifiedHostname=clean(body?.hostname,253).toLowerCase();
      const hostnameMatches=!verifiedHostname||verifiedHostname===requestHostname;
      return body?.success===true&&hostnameMatches?{allowed:true,mode:"provider_verified"}:{allowed:false,mode:"blocked"};
    }
    const res=await fetch(safeEndpoint,{method:"POST",redirect:"error",headers:{"Content-Type":"application/json",Authorization:`Bearer ${auth}`},body:JSON.stringify({provider:form.challenge_provider,token}),signal:controller.signal});
    if(!res.ok)return {allowed:false,mode:"blocked"};
    const body=await res.json().catch(()=>null);
    return body?.success===true?{allowed:true,mode:"provider_verified"}:{allowed:false,mode:"blocked"};
  }finally{clearTimeout(timer);}
}

Deno.serve(async(req)=>{
  const origin=requestOrigin(req);
  if(req.method==="OPTIONS")return new Response(null,{status:origin?204:403,headers:cors(origin)});
  if(req.method!=="POST")return response({ok:false,error:"Method not allowed."},405,origin);
  if(!origin)return response({ok:false,error:"A valid HTTPS origin is required."},403,origin);
  const declaredSize=Number(req.headers.get("content-length")||"0");
  if(Number.isFinite(declaredSize)&&declaredSize>MAX_REQUEST_BYTES)return response({ok:false,error:"Request body is too large."},413,origin);
  const rawBody=await req.text();const payloadSize=new TextEncoder().encode(rawBody).byteLength;
  if(payloadSize>MAX_REQUEST_BYTES)return response({ok:false,error:"Request body is too large."},413,origin);
  let p:Payload;
  try{p=JSON.parse(rawBody) as Payload;}catch{return response({ok:false,error:"Request body must be valid JSON."},400,origin);}
  const admin=createClient(secret("SUPABASE_URL"),secret("SUPABASE_SERVICE_ROLE_KEY"),{auth:{persistSession:false}});
  try{
    const formKey=clean(p.form_key,90);if(!formKey)return response({ok:false,error:"Form key is required."},400,origin);
    const formRes=await admin.from("business_lead_forms").select("id,client_id,project_id,status,allowed_origins,allowed_service_keys,max_message_length,hourly_limit,require_challenge,challenge_provider").eq("form_key",formKey).single();
    if(formRes.error||!formRes.data)return response({ok:false,error:"Lead form is unavailable."},404,origin);const form=formRes.data as FormRow;if(form.status!=="active")return response({ok:false,error:"Lead form is paused."},409,origin);
    const allowed=form.allowed_origins||[];if(!allowed.includes(origin))return response({ok:false,error:"Origin is not allowed."},403,origin);
    const forwarded=(req.headers.get("x-forwarded-for")||"").split(",")[0].trim();const ua=req.headers.get("user-agent")||"unknown";const fingerprint=await sha256(`${secret("NXQ_LEAD_FINGERPRINT_SALT")}|${forwarded}|${ua}`);
    const quota=await reserveLeadQuota(admin,form,fingerprint);
    if(!quota?.allowed){await admin.from("business_lead_intake_attempts").insert({form_id:form.id,client_id:form.client_id,request_fingerprint_hash:fingerprint,outcome:"rate_limited",reason:"hourly_limit"});return response({ok:false,error:"Too many requests. Try again later.",retry_after_seconds:quota?.retry_after_seconds||3600},429,origin);}
    if(clean(p.company_website,500)){await admin.from("business_lead_intake_attempts").insert({form_id:form.id,client_id:form.client_id,request_fingerprint_hash:fingerprint,outcome:"spam",reason:"honeypot"});return response({ok:true,accepted:true},200,origin);}
    const name=clean(p.name,160),email=clean(p.email,200).toLowerCase(),phone=clean(p.phone,40),service=clean(p.service,120),message=clean(p.message,form.max_message_length),serviceArea=clean(p.service_area,300);
    if(!name||(!email&&!phone)||message.length<3)return response({ok:false,error:"Name, contact method, and message are required."},400,origin);if(!emailOkay(email)||!phoneOkay(phone))return response({ok:false,error:"Contact information is invalid."},400,origin);
    if((form.allowed_service_keys||[]).length>0&&service&&!form.allowed_service_keys!.includes(service))return response({ok:false,error:"Selected service is unavailable."},400,origin);
    const challengeReservationKey=`lead-challenge:${form.id}:${crypto.randomUUID()}`;
    const challengeAuthorization=await admin.rpc("nxq_authorize_paid_capability",{target_client_id:form.client_id,target_feature_key:"lead_capture",target_resources:{api_requests:1},target_estimated_provider_cost_cents:1,target_idempotency_key:challengeReservationKey,target_metadata:{form_id:form.id}});
    if(challengeAuthorization.error||challengeAuthorization.data?.allowed!==true)return response({ok:false,error:"Lead verification is unavailable under the current subscription, billing state, or resource limits."},409,origin);
    let challenge:ChallengeDecision;
    const challengeUsesProvider=Boolean(Deno.env.get("NXQ_LEAD_CHALLENGE_ENDPOINT")?.trim()&&Deno.env.get("NXQ_LEAD_CHALLENGE_TOKEN")?.trim()&&form.require_challenge);
    try{challenge=await verifyChallenge(form,clean(p.challenge_token,4000),origin,forwarded);}
    finally{await admin.rpc("nxq_finalize_economic_usage",{target_client_id:form.client_id,target_idempotency_key:challengeReservationKey,target_actual_provider_cost_cents:challengeUsesProvider?1:0});}
    if(!challenge.allowed){await admin.from("business_lead_intake_attempts").insert({form_id:form.id,client_id:form.client_id,request_fingerprint_hash:fingerprint,outcome:"rejected",reason:"challenge_required_or_unavailable"});return response({ok:false,error:"Verification is required."},403,origin);}
    const submissionReservationKey=`lead-submission:${form.id}:${crypto.randomUUID()}`;
    const submissionAuthorization=await admin.rpc("nxq_authorize_paid_capability",{target_client_id:form.client_id,target_feature_key:"lead_capture",target_resources:{form_submissions:1},target_estimated_provider_cost_cents:0,target_idempotency_key:submissionReservationKey,target_metadata:{form_id:form.id}});
    if(submissionAuthorization.error||submissionAuthorization.data?.allowed!==true)return response({ok:false,error:"Lead intake is unavailable under the current subscription, billing state, or resource limits."},409,origin);
    const leadUrgency=urgency(message);const insert=await admin.from("client_leads").insert({client_id:form.client_id,project_id:form.project_id,source:"website",status:"new",urgency:leadUrgency,service_key:service||null,contact_name:name,contact_email:email||null,contact_phone:phone||null,message,service_area:serviceArea||null,lead_score:score(p),utm:p.utm&&typeof p.utm==="object"?p.utm:{},metadata:{form_id:form.id,origin,challenge_mode:challenge.mode}}).select("id,lead_code").single();
    if(insert.error||!insert.data){await admin.rpc("nxq_finalize_economic_usage",{target_client_id:form.client_id,target_idempotency_key:submissionReservationKey,target_release:true});throw new Error(`Lead creation failed: ${insert.error?.message||"unknown"}`);}
    const finalized=await admin.rpc("nxq_finalize_economic_usage",{target_client_id:form.client_id,target_idempotency_key:submissionReservationKey,target_actual_provider_cost_cents:0});
    if(finalized.error)throw new Error("Lead usage reservation could not be reconciled.");
    await admin.from("business_lead_intake_attempts").insert({form_id:form.id,client_id:form.client_id,request_fingerprint_hash:fingerprint,outcome:"accepted"});
    await admin.from("notification_deliveries").insert({client_id:form.client_id,project_id:form.project_id,channel:"in_app",recipient_kind:"client",template_key:leadUrgency==="urgent"||leadUrgency==="emergency"?"urgent_new_lead":"new_lead",subject:leadUrgency==="urgent"||leadUrgency==="emergency"?"Urgent new website lead":"New website lead",body:`${name} submitted a website inquiry${service?` about ${service}`:""}.`,priority:leadUrgency==="emergency"?"urgent":leadUrgency==="urgent"?"high":"normal",metadata:{lead_id:insert.data.id,lead_code:insert.data.lead_code,urgency:leadUrgency}});
    await admin.rpc("increment_client_usage",{target_client_id:form.client_id,target_usage_key:"leads_received",target_quantity:1,target_unit:"lead",target_product_family_slug:"business"});
    return response({ok:true,accepted:true,lead_reference:insert.data.lead_code},201,origin);
  }catch(error){return response({ok:false,error:error instanceof Error?error.message:"Lead intake failed."},500,origin);}
});
