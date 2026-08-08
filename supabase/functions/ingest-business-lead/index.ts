import { createClient } from "npm:@supabase/supabase-js@2";

type Payload={form_key?:string;name?:string;email?:string;phone?:string;service?:string;message?:string;service_area?:string;utm?:Record<string,unknown>;company_website?:string;challenge_token?:string};
type FormRow={id:string;client_id:string;project_id:string;status:string;allowed_origins:string[]|null;allowed_service_keys:string[]|null;max_message_length:number;hourly_limit:number;require_challenge:boolean;challenge_provider:string|null};
const cors={"Content-Type":"application/json","Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"content-type,x-nxq-form-origin","Access-Control-Allow-Methods":"POST,OPTIONS"};
function secret(name:string){const v=Deno.env.get(name)?.trim();if(!v)throw new Error(`Missing protected secret: ${name}`);return v;}
function response(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:cors});}
function clean(value:unknown,max:number){return typeof value==="string"?value.trim().slice(0,max):"";}
async function sha256(value:string){const bytes=new TextEncoder().encode(value);const digest=await crypto.subtle.digest("SHA-256",bytes);return Array.from(new Uint8Array(digest)).map((b)=>b.toString(16).padStart(2,"0")).join("");}
function emailOkay(v:string){return !v||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);}
function phoneOkay(v:string){return !v||/^[+()\-\s\d.]{7,32}$/.test(v);}
function urgency(message:string){const m=message.toLowerCase();if(/(life safety|gas leak|fire|electrical fire|immediate danger)/.test(m))return "emergency";if(/(emergency|urgent|asap|right now|today|storm damage|no heat|no ac|leaking|flood)/.test(m))return "urgent";return "normal";}
function score(p:Payload){let n=25;if(clean(p.email,200))n+=15;if(clean(p.phone,40))n+=15;if(clean(p.service,120))n+=15;if(clean(p.message,4000).length>40)n+=15;if(clean(p.service_area,300))n+=10;return Math.min(100,n);}
async function verifyChallenge(form:FormRow,token:string){
  if(!form.require_challenge)return true;
  const endpoint=Deno.env.get("NXQ_LEAD_CHALLENGE_ENDPOINT")?.trim();const auth=Deno.env.get("NXQ_LEAD_CHALLENGE_TOKEN")?.trim();
  if(!endpoint||!auth||!token)return false;
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),8000);
  try{const res=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${auth}`},body:JSON.stringify({provider:form.challenge_provider,token}),signal:controller.signal});if(!res.ok)return false;const body=await res.json().catch(()=>null);return body?.success===true;}finally{clearTimeout(timer);}
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
  if(req.method!=="POST")return response({ok:false,error:"Method not allowed."},405);
  const admin=createClient(secret("SUPABASE_URL"),secret("SUPABASE_SERVICE_ROLE_KEY"),{auth:{persistSession:false}});
  try{
    const p=(await req.json()) as Payload;const formKey=clean(p.form_key,90);if(!formKey)return response({ok:false,error:"Form key is required."},400);
    const formRes=await admin.from("business_lead_forms").select("id,client_id,project_id,status,allowed_origins,allowed_service_keys,max_message_length,hourly_limit,require_challenge,challenge_provider").eq("form_key",formKey).single();
    if(formRes.error||!formRes.data)return response({ok:false,error:"Lead form is unavailable."},404);const form=formRes.data as FormRow;if(form.status!=="active")return response({ok:false,error:"Lead form is paused."},409);
    const origin=req.headers.get("origin")||req.headers.get("x-nxq-form-origin")||"";const allowed=form.allowed_origins||[];if(allowed.length>0&&!allowed.includes(origin))return response({ok:false,error:"Origin is not allowed."},403);
    const forwarded=(req.headers.get("x-forwarded-for")||"").split(",")[0].trim();const ua=req.headers.get("user-agent")||"unknown";const fingerprint=await sha256(`${secret("NXQ_LEAD_FINGERPRINT_SALT")}|${forwarded}|${ua}`);
    const hourAgo=new Date(Date.now()-3600000).toISOString();
    const [fingerCount,totalCount]=await Promise.all([
      admin.from("business_lead_intake_attempts").select("id",{count:"exact",head:true}).eq("form_id",form.id).eq("request_fingerprint_hash",fingerprint).gte("created_at",hourAgo),
      admin.from("business_lead_intake_attempts").select("id",{count:"exact",head:true}).eq("form_id",form.id).gte("created_at",hourAgo),
    ]);
    if((fingerCount.count||0)>=Math.min(8,form.hourly_limit)||(totalCount.count||0)>=form.hourly_limit){await admin.from("business_lead_intake_attempts").insert({form_id:form.id,client_id:form.client_id,request_fingerprint_hash:fingerprint,outcome:"rate_limited",reason:"hourly_limit"});return response({ok:false,error:"Too many requests. Try again later."},429);}
    if(clean(p.company_website,500)){await admin.from("business_lead_intake_attempts").insert({form_id:form.id,client_id:form.client_id,request_fingerprint_hash:fingerprint,outcome:"spam",reason:"honeypot"});return response({ok:true,accepted:true});}
    if(!(await verifyChallenge(form,clean(p.challenge_token,4000)))){await admin.from("business_lead_intake_attempts").insert({form_id:form.id,client_id:form.client_id,request_fingerprint_hash:fingerprint,outcome:"rejected",reason:"challenge_required_or_failed"});return response({ok:false,error:"Verification is required."},403);}
    const name=clean(p.name,160),email=clean(p.email,200).toLowerCase(),phone=clean(p.phone,40),service=clean(p.service,120),message=clean(p.message,form.max_message_length),serviceArea=clean(p.service_area,300);
    if(!name||(!email&&!phone)||message.length<3)return response({ok:false,error:"Name, contact method, and message are required."},400);if(!emailOkay(email)||!phoneOkay(phone))return response({ok:false,error:"Contact information is invalid."},400);
    if((form.allowed_service_keys||[]).length>0&&service&&!form.allowed_service_keys!.includes(service))return response({ok:false,error:"Selected service is unavailable."},400);
    const leadUrgency=urgency(message);const insert=await admin.from("client_leads").insert({client_id:form.client_id,project_id:form.project_id,source:"website",status:"new",urgency:leadUrgency,service_key:service||null,contact_name:name,contact_email:email||null,contact_phone:phone||null,message,service_area:serviceArea||null,lead_score:score(p),utm:p.utm&&typeof p.utm==="object"?p.utm:{},metadata:{form_id:form.id,origin}}).select("id,lead_code").single();
    if(insert.error||!insert.data)throw new Error(`Lead creation failed: ${insert.error?.message||"unknown"}`);
    await admin.from("business_lead_intake_attempts").insert({form_id:form.id,client_id:form.client_id,request_fingerprint_hash:fingerprint,outcome:"accepted"});
    await admin.from("notification_deliveries").insert({client_id:form.client_id,project_id:form.project_id,channel:"in_app",recipient_kind:"client",template_key:leadUrgency==="urgent"||leadUrgency==="emergency"?"urgent_new_lead":"new_lead",subject:leadUrgency==="urgent"||leadUrgency==="emergency"?"Urgent new website lead":"New website lead",body:`${name} submitted a website inquiry${service?` about ${service}`:""}.`,priority:leadUrgency==="emergency"?"urgent":leadUrgency==="urgent"?"high":"normal",metadata:{lead_id:insert.data.id,lead_code:insert.data.lead_code,urgency:leadUrgency}});
    await admin.rpc("increment_client_usage",{target_client_id:form.client_id,target_usage_key:"leads_received",target_quantity:1,target_unit:"lead",target_product_family_slug:"business"});
    return response({ok:true,accepted:true,lead_reference:insert.data.lead_code},201);
  }catch(error){return response({ok:false,error:error instanceof Error?error.message:"Lead intake failed."},500);}
});