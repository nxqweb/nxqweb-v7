import { createClient } from "npm:@supabase/supabase-js@2";

const workerName="run-backup-restore-drill";
const headers={"Content-Type":"application/json"};
function secret(name:string){const v=Deno.env.get(name)?.trim();if(!v)throw new Error(`Missing protected secret: ${name}`);return v;}
function response(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers});}

Deno.serve(async(req)=>{
  if(req.method!=="POST")return response({ok:false,error:"Method not allowed."},405);
  if(req.headers.get("x-nxq-worker-token")!==secret("NXQ_AUTOMATION_WORKER_TOKEN"))return response({ok:false,error:"Unauthorized."},401);
  const admin=createClient(secret("SUPABASE_URL"),secret("SUPABASE_SERVICE_ROLE_KEY"),{auth:{persistSession:false}});
  try{
    await admin.rpc("record_worker_heartbeat",{target_worker_key:workerName,target_execution_target:"scheduler",target_status:"healthy",target_metadata:{started_at:new Date().toISOString(),mode:"non_destructive"},target_last_error:null});
    const configs=await admin.from("project_deployment_configs").select("project_id,client_id,production_url,last_deployed_commit,last_deployment_status").eq("last_deployment_status","published").not("production_url","is",null).not("last_deployed_commit","is",null).limit(25);
    if(configs.error)throw new Error(configs.error.message);
    const results:Record<string,unknown>[]=[];const weekAgo=new Date(Date.now()-7*86400000).toISOString();
    for(const config of configs.data||[]){
      const recent=await admin.from("disaster_recovery_runs").select("id,status,completed_at").eq("project_id",config.project_id).in("run_type",["simulation","restore_test"]).gte("created_at",weekAgo).order("created_at",{ascending:false}).limit(1).maybeSingle();
      if(recent.error)throw new Error(recent.error.message);
      if(recent.data?.status==="passed"){results.push({project_id:config.project_id,status:"skipped_recent_pass"});continue;}
      const point=await admin.rpc("create_verified_project_restore_point",{target_project_id:config.project_id,target_restore_kind:"full_project"});
      if(point.error||!point.data){results.push({project_id:config.project_id,status:"restore_point_failed",error:point.error?.message||"unknown"});continue;}
      const simulation=await admin.rpc("simulate_project_restore",{target_restore_point_id:point.data});
      if(simulation.error){results.push({project_id:config.project_id,status:"simulation_failed",restore_point_id:point.data,error:simulation.error.message});continue;}
      results.push({project_id:config.project_id,status:simulation.data?.ok?"passed":"failed",restore_point_id:point.data,recovery_run_id:simulation.data?.recovery_run_id||null,external_changes_made:false});
    }
    const readiness=await admin.rpc("evaluate_launch_readiness");
    if(readiness.error)throw new Error(`Readiness refresh failed: ${readiness.error.message}`);
    const failed=results.filter((row)=>row.status==="failed"||String(row.status).includes("failed"));
    await admin.rpc("record_worker_heartbeat",{target_worker_key:workerName,target_execution_target:"scheduler",target_status:failed.length?"degraded":"healthy",target_metadata:{completed_at:new Date().toISOString(),projects_checked:results.length,failed:failed.length,external_changes_made:false},target_last_error:failed.length?"One or more non-destructive recovery drills failed.":null});
    return response({ok:failed.length===0,projects_checked:results.length,results,external_changes_made:false});
  }catch(error){const message=error instanceof Error?error.message:"Backup restore drill failed.";await admin.rpc("record_worker_heartbeat",{target_worker_key:workerName,target_execution_target:"scheduler",target_status:"error",target_metadata:{failed_at:new Date().toISOString(),external_changes_made:false},target_last_error:message});return response({ok:false,error:message,external_changes_made:false},500);}
});
