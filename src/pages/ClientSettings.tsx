import { useEffect, useState } from "react";
import { ArrowLeft, Bell, FileText, Globe2, KeyRound, Mail, Moon, Save, ShieldCheck, Sun } from "lucide-react";
import { ClientPlanManagement } from "../components/ClientPlanManagement";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

type ClientDomainRow = { id: string; domain_name: string; status: string; };

export function ClientSettings() {
  const [email, setEmail] = useState(""); const [newEmail, setNewEmail] = useState(""); const [newPassword, setNewPassword] = useState(""); const [confirmPassword, setConfirmPassword] = useState(""); const [domains, setDomains] = useState<ClientDomainRow[]>([]);
  const [theme, setTheme] = useState<"dark" | "light">(() => { const saved = window.localStorage.getItem("nxq-theme"); return saved === "light" ? "light" : "dark"; });
  const [loading, setLoading] = useState(true); const [savingEmail, setSavingEmail] = useState(false); const [savingPassword, setSavingPassword] = useState(false); const [message, setMessage] = useState(""); const [error, setError] = useState("");

  useEffect(() => { document.body.dataset.nxqTheme = theme; window.localStorage.setItem("nxq-theme", theme); }, [theme]);
  useEffect(() => { void loadSettings(); }, []);

  async function loadSettings() {
    setLoading(true); setError("");
    if (!isSupabaseConfigured || !supabase) { setError("Client settings are temporarily unavailable."); setLoading(false); return; }
    const sessionResult = await supabase.auth.getSession(); const session = sessionResult.data.session;
    if (!session) { window.location.replace("/portal/login"); return; }
    const currentEmail = session.user.email || ""; setEmail(currentEmail); setNewEmail(currentEmail);
    const domainResult = await supabase.rpc("current_client_domain_page", {
      target_limit: 50,
      target_cursor_requested_at: null,
      target_cursor_id: null,
    });
    if (domainResult.error) setError("Domain settings could not be loaded right now."); else setDomains((domainResult.data || []) as ClientDomainRow[]);
    setLoading(false);
  }

  async function updateEmail() {
    if (!supabase) return; const cleanEmail = newEmail.trim().toLowerCase();
    if (!cleanEmail || cleanEmail === email.toLowerCase()) { setError("Enter a different valid email address."); return; }
    setSavingEmail(true); setMessage(""); setError(""); const result = await supabase.auth.updateUser({ email: cleanEmail }); setSavingEmail(false);
    if (result.error) { setError("Email could not be updated right now. Please try again."); return; }
    setMessage("Email change requested. Follow any confirmation instructions sent to your inboxes.");
  }

  async function updatePassword() {
    if (!supabase) return;
    if (newPassword.length < 10) { setError("Use a password with at least 10 characters."); return; }
    if (newPassword !== confirmPassword) { setError("The password confirmation does not match."); return; }
    setSavingPassword(true); setMessage(""); setError(""); const result = await supabase.auth.updateUser({ password: newPassword }); setSavingPassword(false);
    if (result.error) { setError("Password could not be updated right now. Please try again."); return; }
    setNewPassword(""); setConfirmPassword(""); setMessage("Password updated successfully.");
  }

  return (
    <main className="nxq-page"><section className="portal-shell">
      <div className="panel-title panel-title-row"><div className="panel-title"><Save size={22}/><div><h1>Client settings</h1><p className="subtle">Manage your account, plan, appearance, security, notifications, files, and domain.</p></div></div><a className="icon-btn" href="/client"><ArrowLeft size={16}/> Back to portal</a></div>
      {error ? <div className="auth-error" role="alert">{error}</div> : null}{message ? <div className="auth-success" role="status">{message}</div> : null}{loading ? <div className="empty-state" role="status">Loading settings...</div> : null}
      {!loading ? <div className="owner-detail-grid">
        <ClientPlanManagement />
        <section className="panel panel-wide"><div className="panel-title">{theme === "dark" ? <Moon size={20}/> : <Sun size={20}/>}<div><h2>Appearance</h2><p className="subtle">Choose the portal theme saved on this device.</p></div></div><button className="wide-btn" type="button" onClick={() => setTheme(current => current === "dark" ? "light" : "dark")}>{theme === "dark" ? <Sun size={16}/> : <Moon size={16}/>} Switch to {theme === "dark" ? "light" : "dark"} mode</button></section>

        <section className="panel panel-wide"><div className="panel-title"><ShieldCheck size={20}/><div><h2>NXQ account & workspace controls</h2><p className="subtle">Dedicated pages keep sensitive controls separate from the main portal.</p></div></div><div className="client-control-row"><a className="icon-btn" href="/client/security-privacy"><ShieldCheck size={16}/> Security & privacy</a><a className="icon-btn" href="/client/notifications"><Bell size={16}/> Notifications</a><a className="icon-btn" href="/client/files"><FileText size={16}/> Files</a><a className="icon-btn" href="/client/domain"><Globe2 size={16}/> Domain</a></div></section>

        <section className="panel panel-wide"><div className="panel-title"><Mail size={20}/><div><h2>Email</h2><p className="subtle">Current login: {email || "Not available"}</p></div></div><label className="auth-label" htmlFor="client-settings-email">New email address</label><input className="auth-input" id="client-settings-email" type="email" value={newEmail} onChange={event => setNewEmail(event.target.value)} autoComplete="email"/><button className="wide-btn" type="button" disabled={savingEmail} onClick={() => void updateEmail()}><Mail size={16}/> {savingEmail ? "Requesting change..." : "Change email"}</button></section>

        <section className="panel panel-wide"><div className="panel-title"><KeyRound size={20}/><div><h2>Password</h2><p className="subtle">Use at least 10 characters and avoid reused passwords.</p></div></div><div className="setup-form-grid"><label><span>New password</span><input className="auth-input" type="password" value={newPassword} onChange={event => setNewPassword(event.target.value)} autoComplete="new-password"/></label><label><span>Confirm new password</span><input className="auth-input" type="password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} autoComplete="new-password"/></label></div><button className="wide-btn" type="button" disabled={savingPassword} onClick={() => void updatePassword()}><KeyRound size={16}/> {savingPassword ? "Updating password..." : "Change password"}</button></section>

        <section className="panel panel-wide"><div className="panel-title"><Globe2 size={20}/><div><h2>Domain management</h2><p className="subtle">Connected and pending domains for this client workspace.</p></div></div>{domains.length === 0 ? <div className="empty-state">No domain request has been submitted yet.</div> : domains.map(domain => <div className="owner-message-card" key={domain.id}><strong>{domain.domain_name}</strong><span className="subtle">Status: {domain.status.replaceAll("_", " ")}</span></div>)}<a className="wide-btn" href="/client/domain"><Globe2 size={16}/> Open domain status & automation</a></section>
      </div> : null}
    </section></main>
  );
}
