import { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, FlaskConical, RefreshCw, ShieldAlert } from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

type Candidate={id:string;business_name:string;status:string;created_at:string;has_active_run:boolean};
type QaRun={id:string;run_code:string;client_id:string|null;business_name:string|null;project_id:string|null;test_kind:string;status:string;sequence_group:string|null;sequence_number:number|null;monitor_version:string;evidence:Record<string,unknown>;failure_reason:string|null;started_at:string;deadline_at:string|null;completed_at:string|null};
type Summary={strict_consecutive_business_runs:number;required_consecutive_runs:number;latest_sequence_group:string|null;active_runs:number;passed_runs:number;failed_runs:number;runs:QaRun[];candidate_clients:Candidate[];generated_at:string};

export function OwnerQaLifecycle(){
  const [summary,setSummary]=useState<Summary|null>(null);
  const [clientId,setClientId]=useState("");
  const [testKind,setTestKind]=useState("business_e2e");
  const [sequenceGroup,setSequenceGroup]=useState("business-launch-v1");
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);

  async function load(){
    if(!isSupabaseConfigured||!supabase)return;
    setError("");
    const result=await supabase.rpc("owner_qa_lifecycle_summary");
    if(result.error){setError(result.error.message);return;}
    const next=result.data as Summary;
    setSummary(next);
    if(!clientId){const first=(next.candidate_clients||[]).find((candidate)=>!candidate.has_active_run);if(first)setClientId(first.id);}
  }

  // Intentional initial owner dashboard load. User-driven refreshes call the same loader explicitly.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(()=>{void load();},[]);

  async function register(){
    if(!supabase||!clientId)return;
    setBusy(true);setError("");setMessage("");
    const result=await supabase.rpc("owner_register_disposable_qa_client",{
      target_client_id:clientId,
      target_test_kind:testKind,
      target_sequence_group:sequenceGroup,
    });
    setBusy(false);
    if(result.error){setError(result.error.message);return;}
    setMessage("Disposable QA run registered. Complete the normal APPROVE or DENY decision; NXQ will monitor the rest automatically.");
    await load();
  }

  const streak=summary?.strict_consecutive_business_runs??0;
  const required=summary?.required_consecutive_runs??10;
  const pct=Math.min(100,Math.round((streak/required)*100));

  return <main className="nxq-page"><section className="portal-shell">
    <div className="panel-title panel-title-row"><div className="panel-title"><FlaskConical size={22}/><div><h1>Autonomous QA lifecycle</h1><p className="subtle">Register real disposable NXQ QA clients, then use the normal APPROVE or DENY decision. Runs pass only from strict evidence.</p></div></div><div style={{display:"flex",gap:".6rem",flexWrap:"wrap"}}><button className="icon-btn" onClick={()=>void load()}><RefreshCw size={16}/> Refresh</button><a className="icon-btn" href="/owner"><ArrowLeft size={16}/> Owner</a></div></div>
    {error?<div className="auth-error">{error}</div>:null}{message?<div className="auth-success"><CheckCircle2 size={16}/> {message}</div>:null}
    <div className="portal-grid">
      <section className="panel"><h2>Consecutive clean runs</h2><div className="status-summary">{streak}/{required}</div><p className="subtle">{pct}% of launch gate</p></section>
      <section className="panel"><h2>Active</h2><div className="status-summary">{summary?.active_runs??0}</div></section>
      <section className="panel"><h2>Passed / failed</h2><div className="status-summary">{summary?.passed_runs??0} / {summary?.failed_runs??0}</div></section>
    </div>
    <section className="panel panel-wide"><h2>Register disposable run</h2><p className="subtle">The client must already exist through the real signup/intake path and its business name must begin with “NXQ QA”. Registration never approves, denies, publishes, or deletes anything by itself.</p><div className="setup-form-grid">
      <label><span>QA client</span><select className="auth-input" value={clientId} onChange={(event)=>setClientId(event.target.value)}><option value="">Select a QA client</option>{(summary?.candidate_clients||[]).map((candidate)=><option key={candidate.id} value={candidate.id} disabled={candidate.has_active_run}>{candidate.business_name} · {candidate.status}{candidate.has_active_run?" · active run":""}</option>)}</select></label>
      <label><span>Test kind</span><select className="auth-input" value={testKind} onChange={(event)=>setTestKind(event.target.value)}><option value="business_e2e">Business E2E — approve path</option><option value="deny_path">DENY hard-stop path</option></select></label>
      <label><span>Sequence group</span><input className="auth-input" value={sequenceGroup} maxLength={80} onChange={(event)=>setSequenceGroup(event.target.value)}/></label>
    </div><button className="wide-btn" disabled={busy||!clientId||sequenceGroup.trim().length<3} onClick={()=>void register()}>{busy?"Registering…":"Register QA run"}</button></section>
    <section className="panel panel-wide"><h2>Run history</h2>{!summary?.runs?.length?<div className="empty-state">No disposable QA runs registered yet.</div>:<div style={{display:"grid",gap:".8rem"}}>{summary.runs.map((run)=><article className="owner-message-card" key={run.id}><div className="panel-title panel-title-row"><div className="panel-title">{run.status==="passed"?<CheckCircle2 size={18}/>:<ShieldAlert size={18}/>}<div><strong>{run.business_name||run.run_code}</strong><p className="subtle">{run.run_code} · {run.test_kind.replaceAll("_"," ")} · {run.sequence_group||"no sequence"} #{run.sequence_number??"—"}</p></div></div><span className="status-summary">{run.status}</span></div><p className="subtle">Started {new Date(run.started_at).toLocaleString()}{run.completed_at?` · completed ${new Date(run.completed_at).toLocaleString()}`:""}</p>{run.failure_reason?<p className="auth-error">{run.failure_reason}</p>:null}<details><summary>Strict evidence</summary><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{JSON.stringify(run.evidence,null,2)}</pre></details></article>)}</div>}</section>
  </section></main>;
}
