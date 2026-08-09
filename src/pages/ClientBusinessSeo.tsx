import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, Search, ShieldAlert } from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

type SeoIssue={id:string;category:string;severity:string;status:string;title:string;summary:string|null;auto_fixable:boolean;last_seen_at:string};
type SeoArtifact={id:string;artifact_type:string;status:string;git_path:string|null;canonical_base_url:string|null;last_generated_at:string|null;last_verified_at:string|null;last_error:string|null};

export function ClientBusinessSeo(){
  const [issues,setIssues]=useState<SeoIssue[]>([]);
  const [artifacts,setArtifacts]=useState<SeoArtifact[]>([]);
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(true);

  useEffect(()=>{let active=true;async function load(){
    if(!isSupabaseConfigured||!supabase){if(active){setError("Supabase is not configured yet.");setLoading(false);}return;}
    const session=await supabase.auth.getSession();const user=session.data.session?.user;if(!user){window.location.replace("/portal/login");return;}
    const client=await supabase.from("clients").select("id").eq("auth_user_id",user.id).maybeSingle();
    if(client.error||!client.data){if(active){setError(client.error?.message||"Client account not found.");setLoading(false);}return;}
    const project=await supabase.from("projects").select("id").eq("client_id",client.data.id).order("created_at",{ascending:false}).limit(1).maybeSingle();
    if(project.error||!project.data){if(active){setError(project.error?.message||"Website project not found.");setLoading(false);}return;}
    const [issueRes,artifactRes]=await Promise.all([
      supabase.from("business_seo_issues").select("id,category,severity,status,title,summary,auto_fixable,last_seen_at").eq("project_id",project.data.id).order("last_seen_at",{ascending:false}),
      supabase.from("project_seo_artifacts").select("id,artifact_type,status,git_path,canonical_base_url,last_generated_at,last_verified_at,last_error").eq("project_id",project.data.id).order("artifact_type"),
    ]);
    if(!active)return;if(issueRes.error||artifactRes.error){setError(issueRes.error?.message||artifactRes.error?.message||"SEO status could not load.");setLoading(false);return;}
    setIssues((issueRes.data||[]) as SeoIssue[]);setArtifacts((artifactRes.data||[]) as SeoArtifact[]);setLoading(false);
  }void load();return()=>{active=false;};},[]);

  const open=useMemo(()=>issues.filter((issue)=>issue.status==="open"||issue.status==="blocked"||issue.status==="auto_fixing"),[issues]);
  const high=useMemo(()=>open.filter((issue)=>issue.severity==="high"||issue.severity==="critical").length,[open]);
  const readyArtifacts=useMemo(()=>artifacts.filter((artifact)=>artifact.status==="ready"||artifact.status==="published").length,[artifacts]);

  return <main className="nxq-page"><section className="portal-shell">
    <div className="panel-title panel-title-row"><div className="panel-title"><Search size={22}/><div><h1>SEO center</h1><p className="subtle">Evidence-based SEO status for your NXQ-managed website.</p></div></div><a className="icon-btn" href="/client/business"><ArrowLeft size={16}/>Business</a></div>
    {error?<div className="auth-error" role="alert">{error}</div>:null}
    {loading?<div className="empty-state">Loading SEO status...</div>:null}
    {!loading?<><div className="portal-grid"><section className="panel"><h2>Open issues</h2><div className="status-summary">{open.length}</div></section><section className="panel"><h2>High priority</h2><div className="status-summary">{high}</div></section><section className="panel"><h2>SEO artifacts ready</h2><div className="status-summary">{readyArtifacts}/{artifacts.length}</div></section></div>
    <section className="panel panel-wide"><h2>SEO issues</h2>{open.length===0?<div className="empty-state"><CheckCircle2 size={18}/> No unresolved SEO issues are recorded.</div>:open.map((issue)=><article className="owner-message-card" key={issue.id}><div className="panel-title panel-title-row"><div><strong>{issue.title}</strong><p className="subtle">{issue.category} · {issue.severity} · {issue.status.replaceAll("_"," ")}</p></div>{issue.severity==="high"||issue.severity==="critical"?<ShieldAlert size={18}/>:null}</div>{issue.summary?<p>{issue.summary}</p>:null}<small>{issue.auto_fixable?"NXQ can attempt a safe automated fix.":"NXQ may require review or provider evidence."}</small></article>)}</section>
    <section className="panel panel-wide"><h2>Sitemap & schema artifacts</h2>{artifacts.length===0?<div className="empty-state">Artifacts will appear here as NXQ generates and verifies them.</div>:artifacts.map((artifact)=><article className="owner-message-card" key={artifact.id}><strong>{artifact.artifact_type.replaceAll("_"," ")}</strong><p className="subtle">{artifact.status} {artifact.git_path?`· ${artifact.git_path}`:""}</p>{artifact.last_error?<div className="auth-error">{artifact.last_error}</div>:null}</article>)}</section></>:null}
  </section></main>;
}
