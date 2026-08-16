import { useEffect, useState } from "react";
import { ArrowLeft, Download, ExternalLink, FileText, RefreshCcw, ShieldAlert, ShieldCheck } from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

type FileRow={id:string;client_id:string;bucket_id:string;storage_path:string;file_name:string;file_type:string|null;file_size:number|null;status:string;uploaded_at:string;expires_at:string|null;scan_status:string|null;quarantine_status:string|null;scan_last_error:string|null;scanned_at:string|null;findings:Record<string,unknown>|null};
const PAGE_SIZE=50;
function size(bytes:number|null){if(!bytes||bytes<=0)return "Size unavailable";if(bytes<1024)return `${bytes} B`;if(bytes<1024*1024)return `${(bytes/1024).toFixed(1)} KB`;return `${(bytes/(1024*1024)).toFixed(1)} MB`;}

export function ClientFiles(){
  const [files,setFiles]=useState<FileRow[]>([]);
  const [loading,setLoading]=useState(true);
  const [loadingMore,setLoadingMore]=useState(false);
  const [hasMore,setHasMore]=useState(false);
  const [busy,setBusy]=useState<string|null>(null);
  const [error,setError]=useState("");

  async function fetchPage(cursor?:{uploaded_at:string;id:string}){
    if(!supabase)return {rows:[] as FileRow[],error:"Supabase is not configured yet."};
    const result=await supabase.rpc("current_client_file_page",{
      target_limit:PAGE_SIZE,
      target_cursor_uploaded_at:cursor?.uploaded_at??null,
      target_cursor_id:cursor?.id??null,
    });
    return {rows:(result.data||[]) as FileRow[],error:result.error?.message||""};
  }

  async function load(){
    setLoading(true);
    setError("");
    if(!isSupabaseConfigured||!supabase){setError("Supabase is not configured yet.");setLoading(false);return;}
    const session=await supabase.auth.getSession();
    if(!session.data.session?.user){window.location.replace("/portal/login");return;}
    const page=await fetchPage();
    if(page.error){setError(page.error);setLoading(false);return;}
    setFiles(page.rows);
    setHasMore(page.rows.length===PAGE_SIZE);
    setLoading(false);
  }

  async function loadOlderFiles(){
    const last=files.at(-1);
    if(!last||loadingMore)return;
    setLoadingMore(true);
    setError("");
    const page=await fetchPage({uploaded_at:last.uploaded_at,id:last.id});
    if(page.error)setError(page.error);
    else{
      setFiles(current=>[...current,...page.rows]);
      setHasMore(page.rows.length===PAGE_SIZE);
    }
    setLoadingMore(false);
  }

  useEffect(()=>{void load();},[]);

  async function secureUrl(file:FileRow,download=false){
    if(!supabase)return null;
    if(file.scan_status!=="clean"||file.quarantine_status!=="released"){
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

  return <main className="nxq-page"><section className="portal-shell"><div className="panel-title panel-title-row"><div className="panel-title"><FileText size={22}/><div><h1>Your files</h1><p className="subtle">Private client files. NXQ keeps new uploads restricted until file-security scanning releases them.</p></div></div><div className="client-control-row"><a className="icon-btn" href="/client"><ArrowLeft size={16}/> Portal</a><button className="icon-btn" onClick={()=>void load()}><RefreshCcw size={16}/> Refresh</button></div></div>{error?<div className="auth-error">{error}</div>:null}{loading?<div className="empty-state">Loading files...</div>:files.length===0?<div className="empty-state">No client files yet.</div>:<section className="panel panel-wide"><div className="owner-message-list">{files.map(file=>{const released=file.scan_status==="clean"&&file.quarantine_status==="released";return <article className="owner-message-card" key={file.id}><div className="panel-title panel-title-row"><div className="panel-title">{released?<ShieldCheck size={18}/>:<ShieldAlert size={18}/>}<div><strong>{file.file_name}</strong><p className="subtle">{file.file_type||"Unknown type"} · {size(file.file_size)} · uploaded {new Date(file.uploaded_at).toLocaleString()}</p></div></div><span className="status-summary">{released?"security cleared":(file.scan_status||"scan pending").replaceAll("_"," ")}</span></div>{file.scan_last_error?<div className="auth-error">Security scan: {file.scan_last_error}</div>:null}<div className="client-control-row" style={{marginTop:".75rem"}}><button className="icon-btn" disabled={!released||busy===file.id} onClick={()=>void open(file,false)}><ExternalLink size={16}/>{busy===file.id?"Preparing...":"Open"}</button><button className="icon-btn" disabled={!released||busy===file.id} onClick={()=>void open(file,true)}><Download size={16}/> Download</button></div>{!released?<p className="subtle" style={{marginTop:".65rem"}}>Open/download stays disabled until NXQ receives a clean scanner result.</p>:null}</article>;})}</div>{hasMore?<button className="wide-btn" type="button" disabled={loadingMore} onClick={()=>void loadOlderFiles()}>{loadingMore?"Loading older files...":"Load older files"}</button>:null}</section>}</section></main>;
}
