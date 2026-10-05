import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, FileClock, Lightbulb } from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";
import { buildCycle, statusLabel } from "../lib/reportCycle";
import type { CyclePlan, CycleReport } from "../lib/reportCycle";
import "../styles/trend-chart.css";

type Report={id:string;report_month:string;status:string;uptime_summary:Record<string,unknown>;seo_summary:Record<string,unknown>;analytics_summary:Record<string,unknown>;lead_summary:Record<string,unknown>;maintenance_summary:Record<string,unknown>;security_summary:Record<string,unknown>;change_summary:Record<string,unknown>;usage_summary:Record<string,unknown>;recommendations:unknown[];generated_at:string|null};
type Recommendation={id:string;category:string;priority:string;title:string;summary:string;status:string;auto_safe:boolean;created_at:string};
function compact(value:Record<string,unknown>){const entries=Object.entries(value||{}).slice(0,6);return entries.length?entries.map(([k,v])=>`${k.replaceAll("_"," ")}: ${typeof v==="object"?JSON.stringify(v):String(v)}`).join(" · "):"No verified data yet.";}
export function ClientBusinessReports(){
  const [reports,setReports]=useState<Report[]>([]);
  const [recommendations,setRecommendations]=useState<Recommendation[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [plan,setPlan]=useState<CyclePlan|null>(null);
  const [cycleReports,setCycleReports]=useState<CycleReport[]>([]);
  const [cycleError,setCycleError]=useState(false);
  const [cycleAt,setCycleAt]=useState(()=>Date.now());

  useEffect(()=>{let active=true;async function load(){
    setLoading(true);
    setError("");
    if(!isSupabaseConfigured||!supabase){if(active){setError("Reports are temporarily unavailable. No report or recommendation data was changed.");setLoading(false);}return;}
    const sessionResult=await supabase.auth.getSession();
    if(!sessionResult.data.session){window.location.replace("/portal/login");return;}
    const [r,i,p,m]=await Promise.all([
      supabase.from("client_monthly_business_reports").select("*").order("report_month",{ascending:false}).limit(24),
      supabase.from("client_improvement_recommendations").select("id,category,priority,title,summary,status,auto_safe,created_at").order("created_at",{ascending:false}).limit(100),
      supabase.from("website_maintenance_plans").select("status,monthly_report_enabled,next_monthly_report_at").order("created_at",{ascending:false}).limit(1).maybeSingle(),
      supabase.from("website_monthly_reports").select("report_month,status,generated_at,delivered_at").order("report_month",{ascending:false}).limit(12)
    ]);
    if(!active)return;
    if(p.error||m.error){setCycleError(true);}else{setCycleError(false);setPlan((p.data||null) as CyclePlan|null);setCycleReports((m.data||[]) as CycleReport[]);setCycleAt(Date.now());}
    if(r.error||i.error){setError("Reports could not be verified right now. No report or recommendation data was changed.");setLoading(false);return;}
    setReports((r.data||[]) as Report[]);
    setRecommendations((i.data||[]) as Recommendation[]);
    setLoading(false);
  }void load();return()=>{active=false;};},[]);

  const openRecommendations=recommendations.filter(r=>r.status==="open");
  const cycle=useMemo(()=>buildCycle(plan,cycleReports,cycleAt),[plan,cycleReports,cycleAt]);
  const monthName=(iso:string,style:"long"|"short")=>new Date(`${iso.slice(0,7)}-01T00:00:00`).toLocaleDateString(undefined,style==="long"?{year:"numeric",month:"long"}:{month:"short"});

  return <main className="nxq-page"><section className="portal-shell">
    <div className="panel-title panel-title-row"><div className="panel-title"><FileClock size={22}/><div><h1>Reports & improvements</h1><p className="subtle">Monthly website health, SEO, analytics, lead, maintenance, security, change, and usage summaries.</p></div></div><a className="icon-btn" href="/client/business"><ArrowLeft size={16}/> Business</a></div>
    {error?<div className="auth-error">{error}</div>:null}
    {loading?<div className="empty-state">Loading verified report data...</div>:null}
    {!loading&&!error?<>
      <section className="panel panel-wide"><div className="panel-title"><FileClock size={20}/><div><h2>Monthly report cycle</h2><p className="subtle">Monthly reports are prepared on the first of each month.</p></div></div>{cycleError?<div className="auth-error" role="alert">Monthly cycle could not be verified right now. No dates are shown.</div>:<>
        <p>{cycle.state==="active"?(cycle.nextReportAt?`Next report: ${new Date(cycle.nextReportAt).toLocaleDateString(undefined,{year:"numeric",month:"long",day:"numeric"})}.`:"Your next report date is not available yet."):cycle.state==="paused"?`Your maintenance plan is ${(cycle.planStatus||"inactive").replaceAll("_"," ")}, so monthly reports are not being prepared right now.`:cycle.state==="off"?"Monthly reports are switched off for your website.":"Your monthly cycle starts once your website maintenance plan is set up."}</p>
        <p className="subtle">{cycle.latest?`Latest report: ${monthName(cycle.latest.month,"long")} · ${statusLabel[cycle.latest.status]}${cycle.latest.deliveredAt?` · Delivered ${new Date(cycle.latest.deliveredAt).toLocaleDateString()}`:cycle.latest.generatedAt?` · Prepared ${new Date(cycle.latest.generatedAt).toLocaleDateString()}`:""}.`:"No monthly report has been created yet."}</p>
        <ol className="nxq-cycle" aria-label="Last six months">{cycle.months.map(month=><li key={month.month} data-status={month.status}><strong>{monthName(month.month,"short")}</strong><span>{statusLabel[month.status]}</span></li>)}</ol></>}</section>
      <section className="panel panel-wide"><div className="panel-title"><Lightbulb size={20}/><div><h2>Improvement queue</h2><p className="subtle">Recommendations marked safe may follow the existing guarded automation path; higher-risk changes stay on the review path.</p></div></div>{openRecommendations.length===0?<div className="empty-state">No open recommendations.</div>:openRecommendations.map(r=><article className="owner-message-card" key={r.id}><div className="panel-title panel-title-row"><div><strong>{r.title}</strong><p className="subtle">{r.category} · {r.priority} priority</p></div><span className="status-summary">{r.auto_safe?"Guarded safe path":"Review path"}</span></div><p>{r.summary}</p></article>)}</section>
      <section className="panel panel-wide"><h2>Business summary reports</h2>{reports.length===0?<div className="empty-state">No business summary reports yet. Your monthly report status is shown above.</div>:reports.map(r=><article className="owner-message-card" key={r.id}><div className="panel-title panel-title-row"><div><strong>{new Date(`${r.report_month}T00:00:00`).toLocaleDateString(undefined,{year:"numeric",month:"long"})}</strong><p className="subtle">Status: {r.status} {r.generated_at?`· Generated ${new Date(r.generated_at).toLocaleString()}`:""}</p></div></div><p><strong>Uptime:</strong> {compact(r.uptime_summary)}</p><p><strong>SEO:</strong> {compact(r.seo_summary)}</p><p><strong>Analytics:</strong> {compact(r.analytics_summary)}</p><p><strong>Leads:</strong> {compact(r.lead_summary)}</p><p><strong>Maintenance:</strong> {compact(r.maintenance_summary)}</p><p><strong>Security:</strong> {compact(r.security_summary)}</p><p><strong>Changes:</strong> {compact(r.change_summary)}</p><p><strong>Usage:</strong> {compact(r.usage_summary)}</p></article>)}</section>
    </>:null}
  </section></main>;
}
