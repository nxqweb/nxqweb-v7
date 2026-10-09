import { createClient } from "npm:@supabase/supabase-js@2";

function requestOrigin(req:Request){const value=(req.headers.get("origin")||"").trim();if(!value)return "";try{const url=new URL(value);return url.protocol==="https:"&&url.origin===value?value:"";}catch{return "";}}
function cors(origin:string){return {"Access-Control-Allow-Origin":origin||"https://invalid.nxq.local","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"POST, OPTIONS","Cache-Control":"no-store","Content-Type":"application/json","Vary":"Origin"};}
function response(body:unknown,status=200,origin=""){return new Response(JSON.stringify(body),{status,headers:cors(origin)});}
function requiredSecret(name:string){const value=Deno.env.get(name)?.trim();if(!value)throw new Error(`Missing protected secret: ${name}`);return value;}

Deno.serve(async(req)=>{
  const origin=requestOrigin(req);
  if(req.method==="OPTIONS")return new Response(null,{status:origin?204:403,headers:cors(origin)});
  if(req.method!=="POST")return response({ok:false,error:"POST required."},405,origin);
  try{
    const supabaseUrl=requiredSecret("SUPABASE_URL");
    const anonKey=requiredSecret("SUPABASE_ANON_KEY");
    const serviceRole=requiredSecret("SUPABASE_SERVICE_ROLE_KEY");
    const authorization=req.headers.get("Authorization")?.trim()||"";
    if(!authorization.toLowerCase().startsWith("bearer "))return response({ok:false,error:"Authentication required."},401,origin);

    const caller=createClient(supabaseUrl,anonKey,{global:{headers:{Authorization:authorization}},auth:{persistSession:false}});
    const userResult=await caller.auth.getUser();
    const user=userResult.data.user;
    if(userResult.error||!user)return response({ok:false,error:"Authentication required."},401,origin);

    const admin=createClient(supabaseUrl,serviceRole,{auth:{persistSession:false}});
    const owner=await admin.from("owner_users").select("id").eq("auth_user_id",user.id).maybeSingle();
    if(owner.error||!owner.data?.id)return response({ok:false,error:"Owner access required."},403,origin);

    const payload=await req.json().catch(()=>({})) as {client_file_id?:unknown;download?:unknown};
    const clientFileId=typeof payload.client_file_id==="string"?payload.client_file_id.trim():"";
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientFileId))return response({ok:false,error:"A valid client file id is required."},400,origin);

    const file=await admin.from("client_files").select("id,client_id,bucket_id,storage_path,file_name,status,expires_at").eq("id",clientFileId).maybeSingle();
    if(file.error||!file.data)return response({ok:false,error:"File not found."},404,origin);
    if(String(file.data.status)==="deleted")return response({ok:false,error:"File is unavailable."},410,origin);
    if(file.data.expires_at&&new Date(String(file.data.expires_at)).getTime()<=Date.now())return response({ok:false,error:"File access has expired."},410,origin);

    const scan=await admin.from("client_file_security_scans").select("status,quarantine_status,released_at").eq("client_file_id",clientFileId).eq("client_id",file.data.client_id).maybeSingle();
    if(scan.error||!scan.data)return response({ok:false,error:"File security verification is not complete."},423,origin);
    if(scan.data.status!=="clean"||scan.data.quarantine_status!=="released"||!scan.data.released_at)return response({ok:false,error:"File remains restricted by NXQX file security."},423,origin);

    const bucket=String(file.data.bucket_id||"client-files").trim();
    const storagePath=String(file.data.storage_path||"").trim();
    if(!bucket||!storagePath||storagePath.includes("..")||storagePath.startsWith("/"))return response({ok:false,error:"Stored file reference is invalid."},500,origin);

    const options=payload.download===true?{download:String(file.data.file_name||"download")}:undefined;
    const signed=await admin.storage.from(bucket).createSignedUrl(storagePath,60,options);
    if(signed.error||!signed.data?.signedUrl)return response({ok:false,error:"Unable to create temporary file access."},500,origin);

    await admin.from("automation_audit_log").insert({client_id:file.data.client_id,event_type:"owner_file_secure_access_issued",actor_type:"owner",details:{owner_user_id:owner.data.id,client_file_id:clientFileId,download:payload.download===true,expires_in_seconds:60,scan_status:scan.data.status,quarantine_status:scan.data.quarantine_status}});
    return response({ok:true,signed_url:signed.data.signedUrl,expires_in_seconds:60,file_name:file.data.file_name},200,origin);
  }catch(error){return response({ok:false,error:error instanceof Error?error.message:"Secure owner file access failed."},500,origin);}
});
