import { createClient } from "npm:@supabase/supabase-js@2";
import { SignJWT, importPKCS8 } from "npm:jose@6";

type Job={id:string;client_id:string;project_id:string;job_type:string;payload?:Record<string,unknown>|null};
type Admin=ReturnType<typeof createClient>;
const workerName="build-business-seo-artifacts";
const jsonHeaders={"Content-Type":"application/json"};
function secret(name:string){const v=Deno.env.get(name)?.trim();if(!v)throw new Error(`Missing protected secret: ${name}`);return v;}
function response(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:jsonHeaders});}
async function timedFetch(input:string,init:RequestInit={},timeoutMs=15000){const c=new AbortController();const t=setTimeout(()=>c.abort(),timeoutMs);try{return await fetch(input,{...init,signal:c.signal});}finally{clearTimeout(t);}}
async function readJson(res:Response){const text=await res.text();if(!text)return null;try{return JSON.parse(text);}catch{return {message:text};}}
function normalizeJob(value:unknown):Job|null{if(value==null)return null;let v=value;if(typeof v==="string")v=JSON.parse(v);if(Array.isArray(v))v=v[0]??null;if(!v||typeof v!=="object")throw new Error("Invalid SEO job.");const j=v as Job;if(!j.id||!j.client_id||!j.project_id)throw new Error("SEO job missing ids.");return j;}
const ghHeaders=(token:string)=>({Accept:"application/vnd.github+json",Authorization:`Bearer ${token}`,"X-GitHub-Api-Version":"2022-11-28","Content-Type":"application/json"});
async function githubToken(){const appId=secret("GITHUB_APP_ID"),installationId=secret("GITHUB_APP_INSTALLATION_ID");const key=await importPKCS8(secret("GITHUB_APP_PRIVATE_KEY").replace(/\\n/g,"\n"),"RS256");const now=Math.floor(Date.now()/1000);const jwt=await new SignJWT({}).setProtectedHeader({alg:"RS256"}).setIssuer(appId).setIssuedAt(now-30).setExpirationTime(now+540).sign(key);const res=await timedFetch(`https://api.github.com/app/installations/${installationId}/access_tokens`,{method:"POST",headers:ghHeaders(jwt),body:JSON.stringify({permissions:{contents:"write",metadata:"read"}})});const body=await readJson(res);if(!res.ok||typeof body?.token!=="string")throw new Error(`GitHub installation token failed (${res.status}).`);return body.token as string;}
async function getRef(owner:string,repo:string,branch:string,token:string){const res=await timedFetch(`https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`,{headers:ghHeaders(token)});if(res.status===404)return null;const body=await readJson(res);if(!res.ok)throw new Error(`GitHub ref lookup failed for ${branch} (${res.status}).`);return body;}
async function ensureSafeBranch(owner:string,repo:string,branch:string,token:string){if(branch==="main"||!branch.startsWith("safe/"))throw new Error("SEO writes require a safe branch.");const existing=await getRef(owner,repo,branch,token);if(existing)return String(existing?.object?.sha||"");const main=await getRef(owner,repo,"main",token);const mainSha=String(main?.object?.sha||"");if(!mainSha)throw new Error("GitHub main branch commit is unavailable for safe SEO branch creation.");const res=await timedFetch(`https://api.github.com/repos/${owner}/${repo}/git/refs`,{method:"POST",headers:ghHeaders(token),body:JSON.stringify({ref:`refs/heads/${branch}`,sha:mainSha})});const body=await readJson(res);if(!res.ok&&res.status!==422)throw new Error(`GitHub safe branch creation failed (${res.status}): ${String(body?.message||"Unknown error")}`);if(res.status===422){const raced=await getRef(owner,repo,branch,token);if(!raced)throw new Error("GitHub safe branch was reported existing but could not be read.");return String(raced?.object?.sha||mainSha);}return String(body?.object?.sha||mainSha);}
async function getFile(owner:string,repo:string,branch:string,path:string,token:string){const res=await timedFetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`,{headers:ghHeaders(token)});if(res.status===404)return null;const body=await readJson(res);if(!res.ok)throw new Error(`GitHub lookup failed for ${path} (${res.status}).`);return body;}
async function putFile(owner:string,repo:string,branch:string,path:string,content:string,token:string,message:string){const existing=await getFile(owner,repo,branch,path,token);const sha=typeof existing?.sha==="string"?existing.sha:undefined;const encoded=btoa(unescape(encodeURIComponent(content)));const res=await timedFetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`,{method:"PUT",headers:ghHeaders(token),body:JSON.stringify({message,content:encoded,branch,...(sha?{sha}:{})})});const body=await readJson(res);if(!res.ok)throw new Error(`GitHub write failed for ${path} (${res.status}): ${String(body?.message||"Unknown error")}`);return String(body?.commit?.sha||"");}
async function sha256(text:string){const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text));return Array.from(new Uint8Array(d)).map(b=>b.toString(16).padStart(2,"0")).join("");}
function cleanBaseUrl(value:unknown){const raw=String(value||"").trim();if(!raw)return "";const u=new URL(raw);if(u.protocol!=="https:")throw new Error("SEO canonical base URL must use HTTPS.");return `${u.protocol}//${u.host}`;}
function escXml(v:unknown){return String(v??"").replace(/[<>&'"]/g,c=>({"<":"&lt;",">":"&gt;","&":"&amp;","'":"&apos;",'"':"&quot;"}[c]||c));}

async function processJob(admin:Admin,job:Job){
  if(job.job_type!=="website_project_seo_refresh")throw new Error("Unsupported SEO worker job type.");
  const [clientRes,projectRes,deployRes,approvalRes,locationsRes,pagesRes]=await Promise.all([
    admin.from("clients").select("id,status,business_name").eq("id",job.client_id).single(),
    admin.from("projects").select("id,product_family_id").eq("id",job.project_id).eq("client_id",job.client_id).single(),
    admin.from("project_deployment_configs").select("github_owner,github_repo,production_url,deployment_status").eq("project_id",job.project_id).single(),
    admin.from("owner_approval_requests").select("id").eq("client_id",job.client_id).eq("request_type","website_setup_review").eq("status","accepted").limit(1).maybeSingle(),
    admin.from("client_locations").select("id,display_name,status,address_line1,address_line2,city,state_region,postal_code,country_code,phone,email,service_area,seo_slug,seo_title,seo_description").eq("client_id",job.client_id).neq("status","closed").order("is_primary",{ascending:false}),
    admin.from("client_location_pages").select("location_id,canonical_path,status,last_generated_at").eq("project_id",job.project_id).in("status",["ready","published"]),
  ]);
  if(!clientRes.data||!["approved","active"].includes(String(clientRes.data.status)))throw new Error("Client is not eligible for SEO generation.");
  if(!projectRes.data||!approvalRes.data)throw new Error("Approved project is required.");
  if(!deployRes.data?.github_owner||!deployRes.data?.github_repo)throw new Error("Project GitHub infrastructure is not ready.");
  const family=await admin.from("product_families").select("slug").eq("id",projectRes.data.product_family_id).maybeSingle();
  if(family.data?.slug!=="business")throw new Error("SEO artifact worker currently supports Business family only.");

  const run=await admin.from("website_automation_runs").select("source_branch").eq("project_id",job.project_id).not("status","in",'(published,failed,cancelled)').order("created_at",{ascending:false}).limit(1).maybeSingle();
  const branch=String(run.data?.source_branch||`safe/seo-${job.project_id.slice(0,8)}`);
  const baseUrl=cleanBaseUrl(deployRes.data.production_url||Deno.env.get("NXQ_SEO_FALLBACK_BASE_URL"));
  if(!baseUrl)throw new Error("Verified HTTPS production/canonical base URL is required before sitemap generation.");

  const locationById=new Map((locationsRes.data||[]).map((l)=>[String(l.id),l]));
  const urls=[`${baseUrl}/`];
  for(const page of pagesRes.data||[]){const loc=locationById.get(String(page.location_id));const canonicalPath=String(page.canonical_path||"").trim();const fallbackPath=loc?.seo_slug?`/locations/${String(loc.seo_slug)}/`:"";const path=canonicalPath||fallbackPath;if(path)urls.push(new URL(path,baseUrl).toString());}
  const uniqueUrls=[...new Set(urls)];
  const sitemap=`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${uniqueUrls.map(u=>`  <url><loc>${escXml(u)}</loc></url>`).join("\n")}\n</urlset>\n`;
  const robots=`User-agent: *\nAllow: /\nSitemap: ${baseUrl}/sitemap.xml\n`;
  const organization={"@context":"https://schema.org","@type":"Organization",name:String(clientRes.data.business_name||"Business"),url:baseUrl};
  const localBusinesses=(locationsRes.data||[]).filter(l=>l.status==="active").map(l=>({"@context":"https://schema.org","@type":"LocalBusiness",name:String(l.display_name||clientRes.data.business_name||"Business"),url:new URL(`/locations/${String(l.seo_slug)}/`,baseUrl).toString(),telephone:l.phone||undefined,email:l.email||undefined,address:{"@type":"PostalAddress",streetAddress:[l.address_line1,l.address_line2].filter(Boolean).join(" ")||undefined,addressLocality:l.city||undefined,addressRegion:l.state_region||undefined,postalCode:l.postal_code||undefined,addressCountry:l.country_code||"US"},areaServed:l.service_area||undefined}));
  const schema=JSON.stringify({organization,locations:localBusinesses},null,2)+"\n";

  const token=await githubToken();
  await ensureSafeBranch(deployRes.data.github_owner,deployRes.data.github_repo,branch,token);
  const sitemapCommit=await putFile(deployRes.data.github_owner,deployRes.data.github_repo,branch,"sitemap.xml",sitemap,token,"NXQ: refresh sitemap");
  const robotsCommit=await putFile(deployRes.data.github_owner,deployRes.data.github_repo,branch,"robots.txt",robots,token,"NXQ: refresh robots");
  const schemaCommit=await putFile(deployRes.data.github_owner,deployRes.data.github_repo,branch,"seo.schema.json",schema,token,"NXQ: refresh structured SEO data");
  const now=new Date().toISOString();
  const artifacts=[{artifact_type:"sitemap",git_path:"sitemap.xml",git_commit_sha:sitemapCommit,content_hash:await sha256(sitemap)},{artifact_type:"robots",git_path:"robots.txt",git_commit_sha:robotsCommit,content_hash:await sha256(robots)},{artifact_type:"organization_schema",git_path:"seo.schema.json",git_commit_sha:schemaCommit,content_hash:await sha256(schema)}];
  for(const artifact of artifacts){const up=await admin.from("project_seo_artifacts").upsert({client_id:job.client_id,project_id:job.project_id,...artifact,status:"ready",canonical_base_url:baseUrl,last_generated_at:now,last_error:null,metadata:{branch,worker:workerName,url_count:uniqueUrls.length,location_count:localBusinesses.length}},{onConflict:"project_id,artifact_type"});if(up.error)throw new Error(`SEO artifact state failed: ${up.error.message}`);}
  await admin.from("business_seo_issues").update({status:"resolved",resolved_at:now,updated_at:now}).eq("project_id",job.project_id).in("issue_key",["missing_sitemap","missing_robots","missing_organization_schema"]).eq("auto_fixable",true);
  return {branch,base_url:baseUrl,url_count:uniqueUrls.length,location_count:localBusinesses.length,artifacts};
}

Deno.serve(async(req)=>{if(req.method!=="POST")return response({ok:false,error:"Method not allowed."},405);if(req.headers.get("x-nxq-worker-token")!==secret("NXQ_AUTOMATION_WORKER_TOKEN"))return response({ok:false,error:"Unauthorized."},401);const admin=createClient(secret("SUPABASE_URL"),secret("SUPABASE_SERVICE_ROLE_KEY"),{auth:{persistSession:false}});let job:Job|null=null;try{const claim=await admin.rpc("claim_next_external_automation_job",{target_execution_target:"edge",worker_name:workerName,target_job_types:["website_project_seo_refresh"]});if(claim.error)throw new Error(`SEO claim failed: ${claim.error.message}`);job=normalizeJob(claim.data);if(!job)return response({ok:true,claimed:false});const result=await processJob(admin,job);const done=await admin.rpc("complete_external_automation_job",{target_job_id:job.id,worker_name:workerName,target_result:result});if(done.error)throw new Error(`SEO completion failed: ${done.error.message}`);return response({ok:true,claimed:true,job_id:job.id,result});}catch(error){const message=error instanceof Error?error.message:"Unknown SEO generation error";if(job?.id)await admin.rpc("fail_external_automation_job",{target_job_id:job.id,worker_name:workerName,target_error:message});return response({ok:false,job_id:job?.id||null,error:message},500);}});
