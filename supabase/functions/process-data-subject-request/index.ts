import { createClient } from "npm:@supabase/supabase-js@2";

type Job={id:string;client_id:string|null;project_id:string|null;job_type:string;payload?:Record<string,unknown>|null};
type RequestRow={id:string;nxq_account_id:string|null;client_id:string|null;request_type:string;status:string;scope:Record<string,unknown>|null};
const workerName="process-data-subject-request";
const headers={"Content-Type":"application/json"};
function secret(name:string){const v=Deno.env.get(name)?.trim();if(!v)throw new Error(`Missing protected secret: ${name}`);return v;}
function response(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers});}
function normalizeJob(value:unknown):Job|null{if(value==null)return null;let v=value;if(typeof v==="string")v=JSON.parse(v);if(Array.isArray(v))v=v[0]??null;if(!v||typeof v!=="object")throw new Error("Invalid privacy job.");const j=v as Job;if(!j.id)throw new Error("Privacy job missing id.");return j;}

Deno.serve(async(req)=>{
  if(req.method!=="POST")return response({ok:false,error:"Method not allowed."},405);
  if(req.headers.get("x-nxq-worker-token")!==secret("NXQ_AUTOMATION_WORKER_TOKEN"))return response({ok:false,error:"Unauthorized."},401);
  const admin=createClient(secret("SUPABASE_URL"),secret("SUPABASE_SERVICE_ROLE_KEY"),{auth:{persistSession:false}});
  let job:Job|null=null;
  try{
    const claim=await admin.rpc("claim_next_external_automation_job",{target_execution_target:"edge",worker_name:workerName,target_job_types:["process_data_subject_request"]});
    if(claim.error)throw new Error(`Privacy claim failed: ${claim.error.message}`);job=normalizeJob(claim.data);if(!job)return response({ok:true,claimed:false});
    const requestId=String(job.payload?.data_subject_request_id||"");if(!requestId)throw new Error("Privacy job is missing request id.");
    const requestRes=await admin.from("data_subject_requests").select("id,nxq_account_id,client_id,request_type,status,scope").eq("id",requestId).single();
    if(requestRes.error||!requestRes.data)throw new Error(requestRes.error?.message||"Privacy request not found.");
    const r=requestRes.data as RequestRow;if(r.status!=="queued")throw new Error(`Privacy request is not queued (${r.status}).`);
    await admin.from("data_subject_requests").update({status:"processing",updated_at:new Date().toISOString()}).eq("id",r.id).eq("status","queued");

    let result:Record<string,unknown>={processor:"nxq-privacy-v1",request_type:r.request_type,processed_at:new Date().toISOString()};
    let nextStatus="completed";

    if(r.request_type==="export"){
      const [account,memberships,client,locations,consents,securityEvents]=await Promise.all([
        r.nxq_account_id?admin.from("nxq_accounts").select("nxq_id,status,created_at,updated_at").eq("id",r.nxq_account_id).maybeSingle():Promise.resolve({data:null,error:null}),
        r.nxq_account_id?admin.from("nxq_product_memberships").select("product_key,status,verification_level,created_at,updated_at").eq("nxq_account_id",r.nxq_account_id).limit(100):Promise.resolve({data:[],error:null}),
        r.client_id?admin.from("clients").select("client_code,business_name,status,created_at,updated_at").eq("id",r.client_id).maybeSingle():Promise.resolve({data:null,error:null}),
        r.client_id?admin.from("client_locations").select("location_code,display_name,status,city,state_region,country_code,service_area,seo_slug,created_at,updated_at").eq("client_id",r.client_id).limit(250):Promise.resolve({data:[],error:null}),
        r.nxq_account_id?admin.from("privacy_consents").select("consent_type,policy_version,status,source,granted_at,withdrawn_at,expires_at,created_at").eq("nxq_account_id",r.nxq_account_id).limit(250):Promise.resolve({data:[],error:null}),
        r.nxq_account_id?admin.from("account_security_events").select("event_type,severity,trusted,user_agent_family,device_reference,created_at").eq("nxq_account_id",r.nxq_account_id).order("created_at",{ascending:false}).limit(250):Promise.resolve({data:[],error:null}),
      ]);
      for(const query of [account,memberships,client,locations,consents,securityEvents])if(query.error)throw new Error(query.error.message);
      result={...result,export_version:"nxq-account-export-v1",bounded:true,account:account.data,product_memberships:memberships.data||[],client_profile:client.data,locations:locations.data||[],privacy_consents:consents.data||[],security_events:securityEvents.data||[],note:"This staged export is bounded. Large files/messages/provider-held data can be delivered through future export adapters."};
      nextStatus="ready";
    }else if(r.request_type==="consent_withdrawal"){
      if(!r.nxq_account_id)throw new Error("NXQ account is required for consent withdrawal.");
      const update=await admin.from("privacy_consents").update({status:"withdrawn",withdrawn_at:new Date().toISOString()}).eq("nxq_account_id",r.nxq_account_id).in("status",["granted"]);
      if(update.error)throw new Error(update.error.message);result={...result,consents_withdrawn:true};
    }else if(r.request_type==="restrict"){
      result={...result,restriction_recorded:true,note:"Provider-specific processing restrictions remain enforced by adapter policy hooks."};
    }else if(r.request_type==="correct"){
      nextStatus="ready";result={...result,needs_specific_fields:true,note:"Correction requests require explicit field/value instructions; NXQ does not guess identity/profile corrections."};
    }else{
      throw new Error(`Unsupported automated privacy request type: ${r.request_type}`);
    }

    const finish=await admin.from("data_subject_requests").update({status:nextStatus,result,last_error:null,completed_at:nextStatus==="completed"?new Date().toISOString():null,updated_at:new Date().toISOString()}).eq("id",r.id);
    if(finish.error)throw new Error(finish.error.message);
    const complete=await admin.rpc("complete_external_automation_job",{target_job_id:job.id,worker_name:workerName,target_result:{data_subject_request_id:r.id,status:nextStatus}});if(complete.error)throw new Error(complete.error.message);
    return response({ok:true,claimed:true,request_id:r.id,status:nextStatus});
  }catch(error){
    const message=error instanceof Error?error.message:"Privacy request processing failed.";
    if(job?.id)await admin.rpc("fail_external_automation_job",{target_job_id:job.id,worker_name:workerName,target_error:message});
    const requestId=String(job?.payload?.data_subject_request_id||"");if(requestId)await admin.from("data_subject_requests").update({status:"failed",last_error:message.slice(0,2000),updated_at:new Date().toISOString()}).eq("id",requestId);
    return response({ok:false,error:message},500);
  }
});