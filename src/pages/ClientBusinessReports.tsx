import { useEffect, useState } from "react";
import { ArrowLeft, FileClock, Lightbulb } from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

type Report={id:string;report_month:string;status:string;uptime_summary:Record<string,unknown>;seo_summary:Record<string,unknown>;analytics_summary:Record<string,unknown>;lead_summary:Record<string,unknown>;maintenance_summary:Record<string,unknown>;security_summary:Record<string,unknown>;change_summary:Record<string,unknown>;usage_summary:Record<string,unknown>;recommendations:unknown[];generated_at:string|null};
type Recommendation={id:string;category:string;priority:string;title:string;summary:string;status:string;auto_safe:boolean;created_at:string};
function compact(value:Record<string,unknown>){const entries=Object.entries(value||{}).slice(0,6);return entries.length?entries.map(([k,v])=>`${k.replaceAll("_"," ")}: ${typeof v==="object"?JSON.stringify(v):String(v)}`).join(" · "):"No verified data yet.";}
export function ClientBusinessReports(){
  const [reports,setReports]=useState<Report[]>([]);
  const [recommendations,setRecommendations]=useState<Recommendation[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");

  useEffect(()=>{let active=true;async function load(){
    setLoading(true);
    setError("");
    if(!isSupabaseConfigured||!supabase){if(active){setError("Reports are temporarily unavailable. No report or recommendation data was changed.");setLoading(false);}return;}
    const [r,i]=await Promise.all([
      supabase.from("client_monthly_business_reports").select("*").order("report_month",{ascending:false}).limit(24),
      supabase.from("client_improvement_recommendations").select("id,category,priority,title,summary,status,auto_safe,created_at").order("created_at",{ascending:false}).limit(100)
    ]);
    if(!active)return;
    if(r.error||i.error){setError("Reports could not be verified right now. No report or recommendation data was changed.");setLoading(false);return;}
    setReports((r.data||[]) as Report[]);
    setRecommendations((i.data||[]) as Recommendation[]);
    setLoading(false);
  }void load();return()=>{active=false;};},[]);

  const openRecommendations=recommendations.filter(r=>r.status==="open");

  return <main className="nxq-page"><section className="portal-shell">
    <div className="panel-title panel-title-row"><div className="panel-title"><FileClock size={22}/><div><h1>Reports & improvements</h1><p className="subtle">Monthly website health, SEO, analytics, lead, maintenance, security, change, and usage summaries.</p></div></div><a className="icon-btn" href="/client/business"><ArrowLeft size={16}/> Business</a></div>
    {error?<div className="auth-error">{error}</div>:null}
    {loading?<div className="empty-state">Loading verified report data...</div>:null}
    {!loading&&!error?<>
      <section className="panel panel-wide"><div className="panel-title"><Lightbulb size={20}/><div><h2>Improvement queue</h2><p className="subtle">Recommendations marked safe may follow the existing guarded automation path; higher-risk changes stay on the review path.</p></div></div>{openRecommendations.length===0?<div className="empty-state">No open recommendations.</div>:openRecommendations.map(r=><article className="owner-message-card" key={r.id}><div className="panel-title panel-title-row"><div><strong>{r.title}</strong><p className="subtle">{r.category} · {r.priority} priority</p></div><span className="status-summary">{r.auto_safe?"Guarded safe path":"Review path"}</span></div><p>{r.summary}</p></article>)}</section>
      <section className="panel panel-wide"><h2>Monthly reports</h2>{reports.length===0?<div className="empty-state">No completed monthly reports yet.</div>:reports.map(r=><article className="owner-message-card" key={r.id}><div className="panel-title panel-title-row"><div><strong>{new Date(`${r.report_month}T00:00:00`).toLocaleDateString(undefined,{year:"numeric",month:"long"})}</strong><p className="subtle">Status: {r.status} {r.generated_at?`· Generated ${new Date(r.generated_at).toLocaleString()}`:""}</p></div></div><p><strong>Uptime:</strong> {compact(r.uptime_summary)}</p><p><strong>SEO:</strong> {compact(r.seo_summary)}</p><p><strong>Analytics:</strong> {compact(r.analytics_summary)}</p><p><strong>Leads:</strong> {compact(r.lead_summary)}</p><p><strong>Maintenance:</strong> {compact(r.maintenance_summary)}</p><p><strong>Security:</strong> {compact(r.security_summary)}</p><p><strong>Changes:</strong> {compact(r.change_summary)}</p><p><strong>Usage:</strong> {compact(r.usage_summary)}</p></article>)}</section>
    </>:null}
  </section></main>;
}
