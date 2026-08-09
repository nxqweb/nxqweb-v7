import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Download, ExternalLink, FileText, RefreshCcw, ShieldAlert, ShieldCheck } from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

type FileRow={id:string;client_id:string;bucket_id:string;storage_path:string;file_name:string;file_type:string|null;file_size:number|null;status:string;uploaded_at:string;expires_at:string|null};
type ScanRow={client_file_id:string;status:string;quarantine_status:string;last_error:string|null;scanned_at:string|null;findings:Record<string,unknown>|null};
function size(bytes:number|null){if(!bytes||bytes<=0)return "Size unavailable";if(bytes<1024)return `${bytes} B`;if(bytes<1024*1024)return `${(bytes/1024).toFixed(1)} KB`;return `${(bytes/(1024*1024)).toFixed(1)} MB`;}

export function ClientFiles(){
  const [files,setFiles]=useState<FileRow[]>([]);
  const [scans,setScans]=useState<ScanRow[]>([]);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState<string|null>(null);
  const [error,setError]=useState("");

  async function load(){
    setLoading(true);
    setError("");
    if(!isSupabaseConfigured||!supabase){setError("Supabase is not configured yet.");setLoading(false);return;}
    const session=await supabase.auth.getSession();
    const uid=session.data.session?.user.id;
    if(!uid){window.location.replace("/portal/login");return;}
    const client=await supabase.from("clients").select("id").eq("auth_user_id",uid).maybeSingle();
    if(client.error||!client.data){setError(client.error?.message||"Client account not found.");setLoading(false);return;}
    const [f,s]=await Promise.all([
      supabase.from("client_files").select("id,client_id,bucket_id,storage_path,file_name,file_type,file_size,status,uploaded_at,expires_at").eq("client_id",client.data.id).neq("status","deleted").order("uploaded_at",{ascending:false}),
      supabase.from("client_file_security_scans").select("client_file_id,status,quarantine_status,last_error,scanned_at,findings").eq("client_id",client.data.id),
    ]);
    const problem=f.error||s.error;
    if(problem){setError(problem.message);setLoading(false);return;}
    setFiles((f.data||[]) as FileRow[]);
    setScans((s.data||[]) as ScanRow[]);
    setLoading(false);
  }

  useEffect(()=>{void load();},[]);
  const scanByFile=useMemo(()=>new Map(scans.map(s=>[s.client_file_id,s])),[scans]);

  async function secureUrl(file:FileRow,download=false){
    if(!supabase)return null;
    const scan=scanByFile.get(file.id);
    if(!scan||scan.status!=="clean"||scan.quarantine_status!=="released"){
      setError("This file is still restricted by NXQ file security and cannot be opened or downloaded yet.");
      return null;
    }
    const result=await supabase.functions.invoke("secure-client-file-access",{
      body:{client_file_id:file.id,download},
    });
    if(result.error){setError(result.error.message||"Unable to create secure file link.");return null;}
    const data=result.data as {ok?:boolean;signed_url?:string;error?:string}|null;
    if(!data?.ok||!data.signed_url){setError(data?.error||"Unable to create secure file link.");return null;}
    return data.signed_url;
  }

  async function open(file:FileRow,download=false){
    setBusy(file.id);
    setError("");
    const url=await secureUrl(file,download);
    setBusy(null);
    if(!url)return;
    if(download){
      const a=document.createElement("a");
      a.href=url;
      a.download=file.file_name;
      a.rel="noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      a.remove();
    }else{
      window.open(url,"_blank","noopener,noreferrer");
    }
  }

  return <main className="nxq-page"><section className="portal-shell"><div className="panel-title panel-title-row"><div className="panel-title"><FileText size={22}/><div><h1>Your files</h1><p className="subtle">Private client files. NXQ keeps new uploads restricted until file-security scanning releases them.</p></div></div><div className="client-control-row"><a className="icon-btn" href="/client"><ArrowLeft size={16}/> Portal</a><button className="icon-btn" onClick={()=>void load()}><RefreshCcw size={16}/> Refresh</button></div></div>{error?<div className="auth-error">{error}</div>:null}{loading?<div className="empty-state">Loading files...</div>:files.length===0?<div className="empty-state">No client files yet.</div>:<section className="panel panel-wide"><div className="owner-message-list">{files.map(file=>{const scan=scanByFile.get(file.id);const released=scan?.status==="clean"&&scan?.quarantine_status==="released";return <article className="owner-message-card" key={file.id}><div className="panel-title panel-title-row"><div className="panel-title">{released?<ShieldCheck size={18}/>:<ShieldAlert size={18}/>}<div><strong>{file.file_name}</strong><p className="subtle">{file.file_type||"Unknown type"} · {size(file.file_size)} · uploaded {new Date(file.uploaded_at).toLocaleString()}</p></div></div><span className="status-summary">{released?"security cleared":(scan?.status||"scan pending").replaceAll("_"," ")}</span></div>{scan?.last_error?<div className="auth-error">Security scan: {scan.last_error}</div>:null}<div className="client-control-row" style={{marginTop:".75rem"}}><button className="icon-btn" disabled={!released||busy===file.id} onClick={()=>void open(file,false)}><ExternalLink size={16}/>{busy===file.id?"Preparing...":"Open"}</button><button className="icon-btn" disabled={!released||busy===file.id} onClick={()=>void open(file,true)}><Download size={16}/> Download</button></div>{!released?<p className="subtle" style={{marginTop:".65rem"}}>Open/download stays disabled until NXQ receives a clean scanner result.</p>:null}</article>;})}</div></section>}</section></main>;
}
