import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Link2, RefreshCcw, ShieldCheck } from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

type Provider={id:string;provider_key:string;status:string;capabilities:string[];required_secret_names:string[];config:Record<string,unknown>;last_checked_at:string|null;last_success_at:string|null;last_error:string|null};
type LinkRow={id:string;provider_key:string;provider_customer_id:string;client_id:string;business_name:string;status:string;verified_at:string|null};
type ClientOption={id:string;business_name:string;billing_status:string;billing_provider:string|null};
type EventRow={id:string;provider_key:string;provider_event_id:string;provider_customer_id:string|null;client_id:string;business_name:string;event_type:string;amount:number|null;currency:string|null;occurred_at:string;received_at:string;applied:boolean;ignored:boolean;ignore_reason:string|null;apply_error:string|null};
type Readiness={required?:boolean;status?:string;evidence?:Record<string,unknown>;last_checked_at?:string|null};
type Summary={providers:Provider[];customer_links:LinkRow[];client_options:ClientOption[];recent_events:EventRow[];readiness:Readiness;secret_values_exposed:boolean;direct_charge_action_available:boolean};

export function OwnerBillingProviderPanel(){
  const [summary,setSummary]=useState<Summary|null>(null);
  const [providerKey,setProviderKey]=useState("");
  const [clientId,setClientId]=useState("");
  const [customerId,setCustomerId]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");

  async function load(){
    if(!isSupabaseConfigured||!supabase)return;
    setError("");
    const result=await supabase.rpc("owner_billing_provider_summary");
    if(result.error){setError(result.error.message);return;}
    const next=result.data as Summary;
    setSummary(next);
    if(!providerKey&&next.providers?.[0])setProviderKey(next.providers[0].provider_key);
    if(!clientId&&next.client_options?.[0])setClientId(next.client_options[0].id);
  }

  // Intentional initial owner-only provider summary load.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(()=>{void load();},[]);

  async function linkCustomer(){
    if(!supabase||!providerKey||!clientId||customerId.trim().length<3)return;
    setBusy(true);setError("");setMessage("");
    const result=await supabase.rpc("owner_link_billing_provider_customer",{target_provider_key:providerKey,target_client_id:clientId,target_provider_customer_id:customerId.trim()});
    setBusy(false);
    if(result.error){setError(result.error.message);return;}
    setCustomerId("");setMessage("Provider customer mapped. No charge was processed.");await load();
  }

  async function setEnabled(provider:Provider,enabled:boolean){
    if(!supabase)return;
    const confirmed=window.confirm(`${enabled?"Enable":"Disable"} online billing readiness for ${provider.provider_key}?\n\nThis does not charge anyone. Enabling makes runtime provider evidence a launch requirement.`);
    if(!confirmed)return;
    setBusy(true);setError("");setMessage("");
    const result=await supabase.rpc("owner_set_online_billing_enabled",{target_provider_key:provider.provider_key,target_enabled:enabled});
    setBusy(false);
    if(result.error){setError(result.error.message);return;}
    setMessage(`Online billing readiness ${enabled?"enabled":"disabled"}. No payment was processed.`);await load();
  }

  return <section className="panel panel-wide">
    <div className="panel-title panel-title-row"><div className="panel-title"><ShieldCheck size={20}/><div><h2>Online billing provider readiness</h2><p className="subtle">Future provider hookup. Secrets stay outside this page, provider customers map server-side, and no action here processes a charge.</p></div></div><button className="icon-btn" type="button" onClick={()=>void load()}><RefreshCcw size={16}/> Refresh</button></div>
    {error?<div className="notice-card error">{error}</div>:null}{message?<div className="notice-card success"><CheckCircle2 size={16}/> {message}</div>:null}
    <div className="portal-grid"><section className="panel"><h3>Readiness</h3><div className="status-summary">{summary?.readiness?.status?.replaceAll("_"," ")||"unknown"}</div><p className="subtle">{summary?.readiness?.required?"Required because online billing is enabled.":"Optional; manual billing remains supported."}</p></section><section className="panel"><h3>Customer mappings</h3><div className="status-summary">{summary?.customer_links?.filter((row)=>row.status==="active").length??0}</div></section><section className="panel"><h3>Recent events</h3><div className="status-summary">{summary?.recent_events?.length??0}</div></section></div>
    <div style={{display:"grid",gap:".8rem"}}>{(summary?.providers||[]).map((provider)=>{const enabled=provider.config?.online_billing_enabled===true;return <article className="owner-message-card" key={provider.id}><div className="panel-title panel-title-row"><div><strong>{provider.provider_key}</strong><p className="subtle">{provider.status} · {enabled?"online billing enabled":"manual billing mode"}</p></div><button type="button" className="icon-btn" disabled={busy} onClick={()=>void setEnabled(provider,!enabled)}>{enabled?"Disable online billing":"Enable readiness"}</button></div>{provider.last_error?<p className="auth-error"><AlertTriangle size={15}/> {provider.last_error}</p>:null}<p className="subtle">Required secret names: {(provider.required_secret_names||[]).join(", ")||"None declared"}. Values are never shown here.</p></article>;})}</div>
    <h3 style={{marginTop:"1.2rem"}}>Map provider customer</h3><div className="setup-form-grid"><label><span>Payment provider</span><select className="auth-input" value={providerKey} onChange={(event)=>setProviderKey(event.target.value)}>{(summary?.providers||[]).map((provider)=><option key={provider.id} value={provider.provider_key}>{provider.provider_key}</option>)}</select></label><label><span>NXQ client</span><select className="auth-input" value={clientId} onChange={(event)=>setClientId(event.target.value)}>{(summary?.client_options||[]).map((client)=><option key={client.id} value={client.id}>{client.business_name} · {client.billing_status}</option>)}</select></label><label><span>Provider customer ID</span><input className="auth-input" value={customerId} maxLength={180} onChange={(event)=>setCustomerId(event.target.value)} placeholder="cus_..."/></label></div><button className="wide-btn" type="button" disabled={busy||!providerKey||!clientId||customerId.trim().length<3} onClick={()=>void linkCustomer()}><Link2 size={16}/> Save customer mapping</button>
    {(summary?.customer_links||[]).length?<div className="owner-message-list" style={{marginTop:"1rem"}}>{summary!.customer_links.map((link)=><article className="owner-message-card" key={link.id}><strong>{link.business_name}</strong><p>{link.provider_key} · {link.provider_customer_id}</p><small>{link.status} · verified {link.verified_at?new Date(link.verified_at).toLocaleString():"not yet"}</small></article>)}</div>:null}
    {(summary?.recent_events||[]).length?<details style={{marginTop:"1rem"}}><summary>Recent normalized provider events</summary><div className="owner-message-list">{summary!.recent_events.slice(0,20).map((event)=><article className="owner-message-card" key={event.id}><div className="owner-message-top"><strong>{event.business_name}</strong><span>{event.event_type.replaceAll("_"," ")}</span></div><p>{event.provider_key} · {event.provider_event_id}</p><small>{new Date(event.occurred_at).toLocaleString()} · {event.ignored?`ignored: ${event.ignore_reason||"stale"}`:event.applied?"applied":"pending"}</small>{event.apply_error?<p className="auth-error">{event.apply_error}</p>:null}</article>)}</div></details>:null}
  </section>;
}
