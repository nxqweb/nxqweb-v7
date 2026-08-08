import { createClient } from "npm:@supabase/supabase-js@2";

type Event={event_type?:string;page_path?:string;anonymous_session_key?:string;normalized_x?:number;normalized_y?:number;scroll_depth?:number;consent_version?:string;occurred_at?:string;metadata?:Record<string,unknown>};
type Payload={schema_version?:string;ingest_key?:string;events?:Event[]};
const cors={"Content-Type":"application/json","Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"content-type","Access-Control-Allow-Methods":"POST,OPTIONS"};
function secret(name:string){const v=Deno.env.get(name)?.trim();if(!v)throw new Error(`Missing protected secret: ${name}`);return v;}
function response(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:cors});}
function boundedText(v:unknown,max:number){return typeof v==="string"?v.slice(0,max):"";}
function allowedMetadata(value:unknown){if(!value||typeof value!=="object"||Array.isArray(value))return{};const input=value as Record<string,unknown>;const out:Record<string,unknown>={};for(const key of ["element","destination_kind","viewport_class","device_class","referrer_kind","utm_source","utm_medium","utm_campaign"]){const v=input[key];if(typeof v==="string")out[key]=v.slice(0,100);}return out;}
function normalizeEvent(e:Event,profile:any){
  const type=String(e.event_type||"");if(!["page_view","click","scroll_depth","mouse_heatpoint"].includes(type))throw new Error("Unsupported analytics event type.");
  if(type==="mouse_heatpoint"&&!profile.mouse_tracking_enabled)throw new Error("Mouse heatpoints are not enabled for this project.");
  if(type==="click"&&!profile.click_enabled)throw new Error("Click analytics are disabled.");
  if(type==="scroll_depth"&&!profile.scroll_depth_enabled)throw new Error("Scroll analytics are disabled.");
  if(type==="page_view"&&!profile.page_view_enabled)throw new Error("Page-view analytics are disabled.");
  const x=typeof e.normalized_x==="number"?e.normalized_x:null,y=typeof e.normalized_y==="number"?e.normalized_y:null,depth=typeof e.scroll_depth==="number"?Math.round(e.scroll_depth):null;
  if(x!==null&&(x<0||x>1)||y!==null&&(y<0||y>1)||depth!==null&&(depth<0||depth>100))throw new Error("Analytics coordinates/depth are invalid.");
  const consent=boundedText(e.consent_version,30);if(profile.consent_mode==="required"&&consent!==profile.consent_version)throw new Error("Analytics consent version is missing or stale.");
  const occurred=e.occurred_at?new Date(e.occurred_at):new Date();if(Number.isNaN(occurred.getTime())||Math.abs(Date.now()-occurred.getTime())>86400000)throw new Error("Analytics timestamp is invalid.");
  return {analytics_profile_id:profile.id,client_id:profile.client_id,project_id:profile.project_id,event_type:type,page_path:boundedText(e.page_path||"/",500)||"/",anonymous_session_key:boundedText(e.anonymous_session_key,100)||null,normalized_x:x,normalized_y:y,scroll_depth:depth,consent_version:consent||null,metadata:allowedMetadata(e.metadata),occurred_at:occurred.toISOString()};
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
  if(req.method!=="POST")return response({ok:false,error:"Method not allowed."},405);
  const admin=createClient(secret("SUPABASE_URL"),secret("SUPABASE_SERVICE_ROLE_KEY"),{auth:{persistSession:false}});
  try{
    const p=(await req.json()) as Payload;if(p.schema_version!=="nxq-analytics-v1")return response({ok:false,error:"Unsupported analytics schema."},400);
    const key=boundedText(p.ingest_key,100);if(!key)return response({ok:false,error:"Analytics key is required."},400);
    if(!Array.isArray(p.events)||p.events.length===0||p.events.length>20)return response({ok:false,error:"Analytics batch size is invalid."},400);
    const profileRes=await admin.from("website_analytics_profiles").select("id,client_id,project_id,status,consent_mode,consent_version,page_view_enabled,click_enabled,scroll_depth_enabled,mouse_tracking_enabled,allowed_origins,hourly_event_limit").eq("public_ingest_key",key).single();
    if(profileRes.error||!profileRes.data)return response({ok:false,error:"Analytics profile is unavailable."},404);const profile=profileRes.data;
    if(profile.status!=="enabled")return response({ok:true,accepted:0,disabled:true});
    const origin=req.headers.get("origin")||"";const origins=Array.isArray(profile.allowed_origins)?profile.allowed_origins:[];if(origins.length>0&&!origins.includes(origin))return response({ok:false,error:"Origin is not allowed."},403);
    const hour=new Date();hour.setMinutes(0,0,0);const windowStart=hour.toISOString();
    const windowRes=await admin.from("website_analytics_ingest_windows").select("event_count").eq("analytics_profile_id",profile.id).eq("window_start",windowStart).maybeSingle();if(windowRes.error)throw new Error(windowRes.error.message);
    const nextCount=Number(windowRes.data?.event_count||0)+p.events.length;if(nextCount>Number(profile.hourly_event_limit||5000))return response({ok:false,error:"Analytics rate limit reached."},429);
    const rows=p.events.map((e)=>normalizeEvent(e,profile));const insert=await admin.from("website_analytics_events").insert(rows);if(insert.error)throw new Error(`Analytics insert failed: ${insert.error.message}`);
    const upsert=await admin.from("website_analytics_ingest_windows").upsert({analytics_profile_id:profile.id,window_start:windowStart,event_count:nextCount,updated_at:new Date().toISOString()},{onConflict:"analytics_profile_id,window_start"});if(upsert.error)throw new Error(upsert.error.message);
    await admin.rpc("increment_client_usage",{target_client_id:profile.client_id,target_usage_key:"analytics_events",target_quantity:p.events.length,target_unit:"event",target_product_family_slug:"business"});
    return response({ok:true,accepted:rows.length});
  }catch(error){return response({ok:false,error:error instanceof Error?error.message:"Analytics ingest failed."},400);}
});