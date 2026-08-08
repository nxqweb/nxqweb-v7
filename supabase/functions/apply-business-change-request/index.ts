import { createClient } from "npm:@supabase/supabase-js@2";

type Job={id:string;client_id:string;project_id:string;job_type:string;payload?:Record<string,unknown>|null};
type JsonRecord=Record<string,unknown>;
const workerName="apply-business-change-request";
const headers={"Content-Type":"application/json"};
function secret(name:string){const v=Deno.env.get(name)?.trim();if(!v)throw new Error(`Missing protected secret: ${name}`);return v;}
function response(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers});}
function normalize(value:unknown):Job|null{if(value==null)return null;let v=value;if(typeof v==="string")v=JSON.parse(v);if(Array.isArray(v))v=v[0]??null;if(!v||typeof v!=="object")throw new Error("Invalid change job.");const j=v as Job;if(!j.id||!j.client_id||!j.project_id)throw new Error("Change job missing ids.");return j;}
function text(value:unknown,max=500){const v=typeof value==="string"?value.trim():"";return v.slice(0,max);}
function copyRecord(value:unknown):JsonRecord{return value&&typeof value==="object"&&!Array.isArray(value)?structuredClone(value as JsonRecord):{};}
function safeArray(value:unknown){return Array.isArray(value)?value.map(String).map((v)=>v.trim()).filter(Boolean):[];}

function applyStructuredPatch(buildPlan:JsonRecord,payload:JsonRecord){
  const next=structuredClone(buildPlan);
  const business=copyRecord(next.business); next.business=business;
  const patch=copyRecord(payload.patch);
  const changed:string[]=[];

  if("contact_phone" in patch){business.contact_phone=text(patch.contact_phone,80);changed.push("business.contact_phone");}
  if("contact_email" in patch){business.contact_email=text(patch.contact_email,180).toLowerCase();changed.push("business.contact_email");}
  if("service_area" in patch){business.service_area=text(patch.service_area,500);changed.push("business.service_area");}
  if("goals" in patch){next.goals=text(patch.goals,2500);changed.push("goals");}
  if("desired_style" in patch){next.desired_style=text(patch.desired_style,1800);changed.push("desired_style");}
  if("about" in patch){next.goals=text(patch.about,2500);changed.push("about/goals");}

  let services=safeArray(next.services);
  const additions=safeArray(patch.add_services).slice(0,12);
  const removals=new Set(safeArray(patch.remove_services).map((v)=>v.toLowerCase()));
  if(removals.size){services=services.filter((v)=>!removals.has(v.toLowerCase()));changed.push("services.remove");}
  if(additions.length){for(const s of additions){if(!services.some((v)=>v.toLowerCase()===s.toLowerCase()))services.push(s);}changed.push("services.add");}
  if(services.length)next.services=services.slice(0,24);

  if(changed.length===0)throw new Error("Low-risk change request does not contain a supported structured patch.");
  next.version=Number(next.version||1)+1;
  next.last_change_request_at=new Date().toISOString();
  return {next,changed};
}

Deno.serve(async(req)=>{
  if(req.method!=="POST")return response({ok:false,error:"Method not allowed."},405);
  if(req.headers.get("x-nxq-worker-token")!==secret("NXQ_AUTOMATION_WORKER_TOKEN"))return response({ok:false,error:"Unauthorized."},401);
  const admin=createClient(secret("SUPABASE_URL"),secret("SUPABASE_SERVICE_ROLE_KEY"),{auth:{persistSession:false}});
  let job:Job|null=null;
  try{
    const claim=await admin.rpc("claim_next_external_automation_job",{target_execution_target:"edge",worker_name:workerName,target_job_types:["website_apply_change_request"]});
    if(claim.error)throw new Error(`Change job claim failed: ${claim.error.message}`); job=normalize(claim.data); if(!job)return response({ok:true,claimed:false});
    const changeId=String(job.payload?.change_request_id||""); if(!changeId)throw new Error("Change job missing change_request_id.");
    const [changeRes,clientRes,projectRes,approvalRes]=await Promise.all([
      admin.from("website_change_requests").select("*").eq("id",changeId).eq("client_id",job.client_id).eq("project_id",job.project_id).single(),
      admin.from("clients").select("id,status").eq("id",job.client_id).single(),
      admin.from("projects").select("id,build_plan").eq("id",job.project_id).eq("client_id",job.client_id).single(),
      admin.from("owner_approval_requests").select("id").eq("client_id",job.client_id).eq("request_type","website_setup_review").eq("status","accepted").limit(1).maybeSingle(),
    ]);
    if(!clientRes.data||!["approved","active"].includes(String(clientRes.data.status)))throw new Error("Client is not eligible for automated website changes.");
    if(!approvalRes.data)throw new Error("Original owner approval is required for automated website changes.");
    if(!changeRes.data||changeRes.data.risk_level!=="low")throw new Error("Only low-risk structured change requests can use the automatic change worker.");
    if(!projectRes.data)throw new Error("Project not found.");

    const payload=copyRecord(changeRes.data.requested_payload);
    const {next,changed}=applyStructuredPatch(copyRecord(projectRes.data.build_plan),payload);
    const updateProject=await admin.from("projects").update({build_plan:next,updated_at:new Date().toISOString()}).eq("id",job.project_id).eq("client_id",job.client_id);
    if(updateProject.error)throw new Error(`Project build plan update failed: ${updateProject.error.message}`);
    const changeUpdate=await admin.from("website_change_requests").update({status:"building",automation_plan:{route:"structured_rebuild",changed_fields:changed,build_plan_version:next.version},updated_at:new Date().toISOString()}).eq("id",changeId);
    if(changeUpdate.error)throw new Error(`Change request state failed: ${changeUpdate.error.message}`);
    const revision=await admin.from("website_content_revisions").insert({client_id:job.client_id,project_id:job.project_id,change_request_id:changeId,content_key:"project_build_plan",revision_number:Number(next.version||1),state:"draft",payload:next,source:"autonomous_safe_change"});
    if(revision.error&&!String(revision.error.message).toLowerCase().includes("duplicate"))throw new Error(`Content revision save failed: ${revision.error.message}`);
    const bootstrap=await admin.rpc("bootstrap_ready_website_automation"); if(bootstrap.error)throw new Error(`Website rebuild bootstrap failed: ${bootstrap.error.message}`);
    const complete=await admin.rpc("complete_external_automation_job",{target_job_id:job.id,worker_name:workerName,target_result:{change_request_id:changeId,changed_fields:changed,build_plan_version:next.version,website_automation_bootstrap:bootstrap.data}});
    if(complete.error)throw new Error(`Change job completion failed: ${complete.error.message}`);
    return response({ok:true,claimed:true,job_id:job.id,change_request_id:changeId,changed_fields:changed});
  }catch(error){
    const message=error instanceof Error?error.message:"Unknown change request worker failure";
    if(job?.id)await admin.rpc("fail_external_automation_job",{target_job_id:job.id,worker_name:workerName,target_error:message});
    return response({ok:false,job_id:job?.id||null,error:message},500);
  }
});