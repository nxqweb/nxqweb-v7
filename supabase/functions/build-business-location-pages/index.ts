import { createClient } from "npm:@supabase/supabase-js@2";
import { SignJWT, importPKCS8 } from "npm:jose@6";

type Job = { id:string; client_id:string; project_id:string; job_type:string; payload?:Record<string,unknown>|null };
type JsonRecord = Record<string, unknown>;
type Admin = ReturnType<typeof createClient>;

const workerName = "build-business-location-pages";
const headers = { "Content-Type":"application/json" };

function secret(name:string){ const v=Deno.env.get(name)?.trim(); if(!v) throw new Error(`Missing protected secret: ${name}`); return v; }
function response(body:unknown,status=200){ return new Response(JSON.stringify(body),{status,headers}); }
async function timedFetch(input:string,init:RequestInit={},timeoutMs=15000){ const c=new AbortController(); const t=setTimeout(()=>c.abort(),timeoutMs); try{return await fetch(input,{...init,signal:c.signal});} finally{clearTimeout(t);} }
async function json(res:Response){ const text=await res.text(); if(!text) return null; try{return JSON.parse(text);}catch{return {message:text};} }
function normalizeJob(value:unknown):Job|null{ if(value==null)return null; let v=value; if(typeof v==="string")v=JSON.parse(v); if(Array.isArray(v))v=v[0]??null; if(!v||typeof v!=="object")throw new Error("Invalid location job."); const j=v as Job; if(!j.id||!j.client_id||!j.project_id)throw new Error("Location job missing ids."); return j; }

const ghHeaders=(token:string)=>({Accept:"application/vnd.github+json",Authorization:`Bearer ${token}`,"X-GitHub-Api-Version":"2022-11-28","Content-Type":"application/json"});
async function githubToken(){
  const appId=secret("GITHUB_APP_ID"); const installationId=secret("GITHUB_APP_INSTALLATION_ID");
  const key=await importPKCS8(secret("GITHUB_APP_PRIVATE_KEY").replace(/\\n/g,"\n"),"RS256"); const now=Math.floor(Date.now()/1000);
  const jwt=await new SignJWT({}).setProtectedHeader({alg:"RS256"}).setIssuer(appId).setIssuedAt(now-30).setExpirationTime(now+540).sign(key);
  const res=await timedFetch(`https://api.github.com/app/installations/${installationId}/access_tokens`,{method:"POST",headers:ghHeaders(jwt),body:JSON.stringify({permissions:{contents:"write",metadata:"read"}})});
  const body=await json(res); if(!res.ok||typeof body?.token!=="string")throw new Error(`GitHub installation token failed (${res.status}).`); return body.token as string;
}
async function getFile(owner:string,repo:string,branch:string,path:string,token:string){
  const res=await timedFetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`,{headers:ghHeaders(token)});
  if(res.status===404)return null; const body=await json(res); if(!res.ok)throw new Error(`GitHub lookup failed for ${path} (${res.status}).`); return body;
}
async function putFile(owner:string,repo:string,branch:string,path:string,content:string,token:string,message:string){
  const existing=await getFile(owner,repo,branch,path,token); const sha=typeof existing?.sha==="string"?existing.sha:undefined;
  const encoded=btoa(unescape(encodeURIComponent(content)));
  const res=await timedFetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`,{method:"PUT",headers:ghHeaders(token),body:JSON.stringify({message,content:encoded,branch,...(sha?{sha}:{})})});
  const body=await json(res); if(!res.ok)throw new Error(`GitHub write failed for ${path} (${res.status}): ${String(body?.message||"Unknown error")}`); return body;
}
function esc(value:unknown){ return String(value??"").replace(/[&<>"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]||c)); }
function locationHtml(businessName:string,location:JsonRecord,services:JsonRecord[]){
  const city=String(location.city||""); const region=String(location.state_region||""); const place=[city,region].filter(Boolean).join(", ");
  const title=String(location.seo_title||`${businessName} in ${place||String(location.display_name||"your area")}`);
  const description=String(location.seo_description||`${businessName} provides professional services in ${place||String(location.service_area||"this service area")}.` ).slice(0,160);
  const serviceCards=services.map((s)=>`<article class="service"><h2>${esc(s.service_name)}</h2><p>${esc(s.summary||`Professional ${String(s.service_name||"service")} from ${businessName}.`)}</p></article>`).join("\n");
  const structured={"@context":"https://schema.org","@type":"LocalBusiness",name:businessName,address:{"@type":"PostalAddress",streetAddress:[location.address_line1,location.address_line2].filter(Boolean).join(" "),addressLocality:city,addressRegion:region,postalCode:location.postal_code,addressCountry:location.country_code||"US"},telephone:location.phone||undefined,email:location.email||undefined,areaServed:location.service_area||place||undefined};
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><meta name="description" content="${esc(description)}"><link rel="canonical" href="/${esc(String(location.seo_slug))}/"><script type="application/ld+json">${JSON.stringify(structured).replace(/</g,"\\u003c")}</script><style>body{margin:0;background:#070b12;color:#f6f8fb;font-family:Inter,system-ui,sans-serif}.shell{max-width:1080px;margin:auto;padding:72px 22px}.eyebrow{opacity:.7;text-transform:uppercase;letter-spacing:.15em}.hero{padding:80px 0;border-bottom:1px solid #ffffff18}.hero h1{font-size:clamp(2.4rem,7vw,5.5rem);max-width:900px;margin:.25em 0}.meta{opacity:.72}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:18px;padding:45px 0}.service{background:#ffffff08;border:1px solid #ffffff12;border-radius:22px;padding:25px}a{color:#fff}.cta{display:inline-block;margin-top:20px;padding:14px 20px;border-radius:999px;background:#fff;color:#08101b;text-decoration:none;font-weight:800}</style></head><body><main class="shell"><section class="hero"><p class="eyebrow">${esc(location.display_name||place||"Local service")}</p><h1>${esc(title)}</h1><p class="meta">${esc(description)}</p>${location.phone?`<a class="cta" href="tel:${esc(location.phone)}">Call ${esc(location.phone)}</a>`:""}</section><section class="grid">${serviceCards||`<article class="service"><h2>Professional service</h2><p>Contact ${esc(businessName)} to learn what is available in this location.</p></article>`}</section></main></body></html>`;
}

async function processJob(admin:Admin,job:Job){
  if(job.job_type!=="website_location_seo_refresh")throw new Error("Unsupported location worker job type.");
  const locationId=String(job.payload?.location_id||""); if(!locationId)throw new Error("Location job missing location_id.");
  const [clientRes,projectRes,locationRes,deployRes,approvalRes]=await Promise.all([
    admin.from("clients").select("id,status,business_name").eq("id",job.client_id).single(),
    admin.from("projects").select("id").eq("id",job.project_id).eq("client_id",job.client_id).single(),
    admin.from("client_locations").select("*").eq("id",locationId).eq("client_id",job.client_id).single(),
    admin.from("project_deployment_configs").select("github_owner,github_repo").eq("project_id",job.project_id).single(),
    admin.from("owner_approval_requests").select("id").eq("client_id",job.client_id).eq("request_type","website_setup_review").eq("status","accepted").limit(1).maybeSingle(),
  ]);
  if(!clientRes.data||!["approved","active"].includes(String(clientRes.data.status)))throw new Error("Client is not eligible for location generation.");
  if(!projectRes.data||!approvalRes.data)throw new Error("Approved project is required.");
  if(!locationRes.data||locationRes.data.status==="closed")throw new Error("Location is unavailable or closed.");
  if(!deployRes.data?.github_owner||!deployRes.data?.github_repo)throw new Error("Project GitHub infrastructure is not ready.");
  const servicesRes=await admin.from("client_location_services").select("service_name,service_slug,summary").eq("location_id",locationId).eq("active",true).order("service_name");
  if(servicesRes.error)throw new Error(`Location services load failed: ${servicesRes.error.message}`);
  const run=await admin.from("website_automation_runs").select("source_branch").eq("project_id",job.project_id).not("status","in",'(published,failed,cancelled)').order("created_at",{ascending:false}).limit(1).maybeSingle();
  const branch=String(run.data?.source_branch||`safe/location-${String(locationRes.data.seo_slug)}`);
  const token=await githubToken();
  const path=`locations/${String(locationRes.data.seo_slug)}/index.html`;
  const html=locationHtml(String(clientRes.data.business_name||"Business"),locationRes.data as JsonRecord,(servicesRes.data||[]) as JsonRecord[]);
  const write=await putFile(deployRes.data.github_owner,deployRes.data.github_repo,branch,path,html,token,`NXQ: refresh location page ${String(locationRes.data.display_name)}`);
  const commitSha=String(write?.commit?.sha||"");
  const pageTitle=String(locationRes.data.seo_title||`${clientRes.data.business_name} in ${[locationRes.data.city,locationRes.data.state_region].filter(Boolean).join(", ")}`);
  const canonical=`/locations/${String(locationRes.data.seo_slug)}/`;
  const upsert=await admin.from("client_location_pages").upsert({client_id:job.client_id,project_id:job.project_id,location_id:locationId,page_slug:String(locationRes.data.seo_slug),page_title:pageTitle,meta_description:locationRes.data.seo_description,canonical_path:canonical,status:"ready",content:{git_path:path,git_commit_sha:commitSha,generated_by:workerName},last_generated_at:new Date().toISOString()},{onConflict:"project_id,location_id,page_slug"});
  if(upsert.error)throw new Error(`Location page state failed: ${upsert.error.message}`);
  return {location_id:locationId,path,branch,git_commit_sha:commitSha,status:"ready"};
}

Deno.serve(async(req)=>{
  if(req.method!=="POST")return response({ok:false,error:"Method not allowed."},405);
  const expected=secret("NXQ_AUTOMATION_WORKER_TOKEN"); if(req.headers.get("x-nxq-worker-token")!==expected)return response({ok:false,error:"Unauthorized."},401);
  const url=secret("SUPABASE_URL"); const service=secret("SUPABASE_SERVICE_ROLE_KEY"); const admin=createClient(url,service,{auth:{persistSession:false}});
  let job:Job|null=null;
  try{
    const claim=await admin.rpc("claim_next_external_automation_job",{target_execution_target:"edge",worker_name:workerName,target_job_types:["website_location_seo_refresh"]});
    if(claim.error)throw new Error(`Location claim failed: ${claim.error.message}`); job=normalizeJob(claim.data); if(!job)return response({ok:true,claimed:false});
    const result=await processJob(admin,job);
    const complete=await admin.rpc("complete_external_automation_job",{target_job_id:job.id,worker_name:workerName,target_result:result}); if(complete.error)throw new Error(`Location completion failed: ${complete.error.message}`);
    return response({ok:true,claimed:true,job_id:job.id,result});
  }catch(error){
    const message=error instanceof Error?error.message:"Unknown location generation error";
    if(job?.id)await admin.rpc("fail_external_automation_job",{target_job_id:job.id,worker_name:workerName,target_error:message});
    return response({ok:false,job_id:job?.id||null,error:message},500);
  }
});