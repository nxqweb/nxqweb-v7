import { createClient } from "npm:@supabase/supabase-js@2";

type Job={id:string;client_id:string;project_id:string;job_type:string;payload?:Record<string,unknown>|null};
type JsonRecord=Record<string,unknown>;
type ClassifierResult={route:"safe_patch"|"needs_info"|"owner_review";confidence:number;patch?:JsonRecord;question?:string;reason?:string};
const workerName="classify-business-change-request";
const workerVersion="v2-single-routing-authority";
const headers={"Content-Type":"application/json"};
const supportedPatchKeys=new Set(["contact_phone","contact_email","service_area","goals","desired_style","about","add_services","remove_services"]);
function secret(name:string){const v=Deno.env.get(name)?.trim();if(!v)throw new Error(`Missing protected secret: ${name}`);return v;}
function optionalSecret(name:string){return Deno.env.get(name)?.trim()||"";}
function response(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers});}
function normalize(value:unknown):Job|null{if(value==null)return null;let v=value;if(typeof v==="string")v=JSON.parse(v);if(Array.isArray(v))v=v[0]??null;if(!v||typeof v!=="object")throw new Error("Invalid classifier job.");const j=v as Job;if(!j.id||!j.client_id||!j.project_id)throw new Error("Classifier job missing ids.");return j;}
function record(value:unknown):JsonRecord{return value&&typeof value==="object"&&!Array.isArray(value)?value as JsonRecord:{};}
function cleanText(value:unknown,max:number){return typeof value==="string"?value.trim().slice(0,max):"";}
function validatePatch(value:unknown){const patch=record(value);const keys=Object.keys(patch);if(keys.length===0||keys.some((k)=>!supportedPatchKeys.has(k)))return null;const out:JsonRecord={};for(const key of keys){const raw=patch[key];if(key==="add_services"||key==="remove_services"){if(!Array.isArray(raw))return null;out[key]=raw.map(String).map((v)=>v.trim()).filter(Boolean).slice(0,12);}else out[key]=cleanText(raw,key==="goals"||key==="about"?2500:key==="desired_style"?1800:500);}return out;}
function parseResult(value:unknown):ClassifierResult{const r=record(value);const route=String(r.route||"");if(!["safe_patch","needs_info","owner_review"].includes(route))throw new Error("Classifier returned unsupported route.");const confidence=Number(r.confidence);if(!Number.isFinite(confidence)||confidence<0||confidence>1)throw new Error("Classifier confidence must be between 0 and 1.");return{route:route as ClassifierResult["route"],confidence,patch:record(r.patch),question:cleanText(r.question,700),reason:cleanText(r.reason,1200)};}
function deterministicResult(title:string,description:string):ClassifierResult|null{
  const combined=`${title}\n${description}`;
  const patch:JsonRecord={};
  const email=combined.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
  const phone=combined.match(/(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/)?.[0];
  if(email)patch.contact_email=email.toLowerCase();
  if(phone)patch.contact_phone=phone.trim();
  if(Object.keys(patch).length===0)return null;
  return{route:"safe_patch",confidence:0.99,patch,reason:"Deterministic parser found an explicit supported contact-field change."};
}
async function classify(input:JsonRecord,adapterUrl:string,adapterToken:string){
  if(!adapterUrl||!adapterToken)throw new Error("AI change classifier adapter is not configured.");
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),15000);
  try{
    const res=await fetch(adapterUrl,{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${adapterToken}`},body:JSON.stringify({task:"classify_business_change_request_v2",input,allowed_routes:["safe_patch","needs_info","owner_review"],allowed_patch_keys:[...supportedPatchKeys],rules:{safe_patch_min_confidence:0.9,no_legal_financial_medical_guarantee_or_domain_changes:true,never_publish_or_modify_provider_infrastructure:true,ambiguous_means_needs_info:true}}),signal:controller.signal});
    if(!res.ok)throw new Error(`AI classifier adapter failed with HTTP ${res.status}.`);
    return parseResult(await res.json());
  }finally{clearTimeout(timer);}
}

Deno.serve(async(req)=>{
  if(req.method!=="POST")return response({ok:false,error:"Method not allowed."},405);
  if(req.headers.get("x-nxq-worker-token")!==secret("NXQ_AUTOMATION_WORKER_TOKEN"))return response({ok:false,error:"Unauthorized."},401);
  const admin=createClient(secret("SUPABASE_URL"),secret("SUPABASE_SERVICE_ROLE_KEY"),{auth:{persistSession:false}});
  const adapterUrl=optionalSecret("NXQ_AI_CLASSIFIER_URL");
  const adapterToken=optionalSecret("NXQ_AI_CLASSIFIER_TOKEN");
  const adapterConfigured=Boolean(adapterUrl&&adapterToken);
  let job:Job|null=null;
  try{
    const claim=await admin.rpc("claim_next_external_automation_job",{target_execution_target:"ai",worker_name:workerName,target_job_types:["classify_website_change_request"]});
    if(claim.error)throw new Error(`Classifier job claim failed: ${claim.error.message}`);job=normalize(claim.data);
    await admin.rpc("record_worker_heartbeat",{target_worker_key:workerName,target_execution_target:"ai",target_status:adapterConfigured?"healthy":"degraded",target_metadata:{worker_version:workerVersion,adapter_configured:adapterConfigured,routing_authority:"database_trigger",checked_at:new Date().toISOString()},target_last_error:adapterConfigured?null:"AI classifier adapter URL/token are not configured."});
    if(!job)return response({ok:true,claimed:false,adapter_configured:adapterConfigured});
    const changeId=String(job.payload?.change_request_id||"");if(!changeId)throw new Error("Classifier job missing change_request_id.");
    const [changeRes,clientRes,approvalRes]=await Promise.all([
      admin.from("website_change_requests").select("id,client_id,project_id,request_type,title,description,priority,risk_level,status,requested_payload").eq("id",changeId).eq("client_id",job.client_id).eq("project_id",job.project_id).single(),
      admin.from("clients").select("id,status").eq("id",job.client_id).single(),
      admin.from("owner_approval_requests").select("id").eq("client_id",job.client_id).eq("request_type","website_setup_review").eq("status","accepted").limit(1).maybeSingle(),
    ]);
    if(!clientRes.data||!["approved","active"].includes(String(clientRes.data.status)))throw new Error("Client is not eligible for automated change classification.");
    if(!approvalRes.data)throw new Error("Original owner approval is required for automated website changes.");
    if(!changeRes.data)throw new Error("Change request not found.");
    if(["published","cancelled","failed"].includes(String(changeRes.data.status)))throw new Error("Change request is already terminal.");

    const deterministic=deterministicResult(String(changeRes.data.title||""),String(changeRes.data.description||""));
    const result=deterministic??await classify({request_type:changeRes.data.request_type,title:changeRes.data.title,description:changeRes.data.description,priority:changeRes.data.priority,risk_level:changeRes.data.risk_level,requested_payload:changeRes.data.requested_payload},adapterUrl,adapterToken);
    const evidence={classifier:deterministic?"deterministic-v1":"adapter-v2",confidence:result.confidence,reason:result.reason||null,classified_at:new Date().toISOString(),routing_authority:"database_trigger"};

    if(result.route==="safe_patch"){
      const patch=validatePatch(result.patch);
      if(result.confidence<0.9||!patch){
        await admin.from("website_change_requests").update({status:"blocked",last_error:"Classifier suggested automation but confidence/patch validation did not meet NXQ safety rules.",automation_plan:{route:"owner_review",...evidence}}).eq("id",changeId).eq("client_id",job.client_id);
      }else{
        const update=await admin.from("website_change_requests").update({status:"submitted",risk_level:"low",requested_payload:{patch},last_error:null,automation_plan:{route:"classifier_to_structured_edge",source:deterministic?"deterministic_classifier":"ai_classifier",...evidence}}).eq("id",changeId).eq("client_id",job.client_id);
        if(update.error)throw new Error(`Safe classification update failed: ${update.error.message}`);
      }
    }else if(result.route==="needs_info"){
      const question=result.question||"NXQ needs a little more information before this change can be completed safely.";
      const update=await admin.from("website_change_requests").update({status:"needs_info",last_error:null,automation_plan:{route:"needs_info",question,...evidence}}).eq("id",changeId).eq("client_id",job.client_id);
      if(update.error)throw new Error(`Needs-info update failed: ${update.error.message}`);
    }else{
      const reason=result.reason||"NXQ requires owner review before this change can continue safely.";
      const update=await admin.from("website_change_requests").update({status:"blocked",last_error:reason,automation_plan:{route:"owner_review",...evidence}}).eq("id",changeId).eq("client_id",job.client_id);
      if(update.error)throw new Error(`Owner-review update failed: ${update.error.message}`);
    }

    const complete=await admin.rpc("complete_external_automation_job",{target_job_id:job.id,worker_name:workerName,target_result:{change_request_id:changeId,route:result.route,confidence:result.confidence,classifier:deterministic?"deterministic-v1":"adapter-v2",routing_authority:"database_trigger"}});
    if(complete.error)throw new Error(`Classifier job completion failed: ${complete.error.message}`);
    return response({ok:true,claimed:true,job_id:job.id,change_request_id:changeId,route:result.route,confidence:result.confidence,classifier:deterministic?"deterministic-v1":"adapter-v2"});
  }catch(error){
    const message=error instanceof Error?error.message:"Unknown change classifier failure";
    await admin.rpc("record_worker_heartbeat",{target_worker_key:workerName,target_execution_target:"ai",target_status:"error",target_metadata:{worker_version:workerVersion,adapter_configured:adapterConfigured,routing_authority:"database_trigger",failed_at:new Date().toISOString()},target_last_error:message});
    if(job?.id)await admin.rpc("fail_external_automation_job",{target_job_id:job.id,worker_name:workerName,target_error:message});
    return response({ok:false,job_id:job?.id||null,error:message},500);
  }
});