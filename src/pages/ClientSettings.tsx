import { useEffect, useState } from "react";
import { ArrowLeft, KeyRound, Mail, Moon, Save, Sun, Globe2 } from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

type ClientDomainRow = {
  id: string;
  domain_name: string;
  status: string;
};

export function ClientSettings() {
  const [email, setEmail] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [domains, setDomains] = useState<ClientDomainRow[]>([]);
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    const saved = window.localStorage.getItem("nxq-theme");
    return saved === "light" ? "light" : "dark";
  });
  const [loading, setLoading] = useState(true);
  const [savingEmail, setSavingEmail] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    document.body.dataset.nxqTheme = theme;
    window.localStorage.setItem("nxq-theme", theme);
  }, [theme]);

  useEffect(() => {
    void loadSettings();
  }, []);

  async function loadSettings() {
    setLoading(true);
    setError("");

    if (!isSupabaseConfigured || !supabase) {
      setError("Supabase is not configured.");
      setLoading(false);
      return;
    }

    const sessionResult = await supabase.auth.getSession();
    const session = sessionResult.data.session;

    if (!session) {
      window.location.replace("/portal/login");
      return;
    }

    const currentEmail = session.user.email || "";
    setEmail(currentEmail);
    setNewEmail(currentEmail);

    const clientResult = await supabase
      .from("clients")
      .select("id")
      .eq("auth_user_id", session.user.id)
      .maybeSingle();

    if (clientResult.error) {
      setError(`Client settings load failed: ${clientResult.error.message}`);
      setLoading(false);
      return;
    }

    if (clientResult.data?.id) {
      const domainResult = await supabase
        .from("client_domains")
        .select("id, domain_name, status")
        .eq("client_id", clientResult.data.id)
        .order("requested_at", { ascending: false });

      if (domainResult.error) {
        setError(`Domain settings load failed: ${domainResult.error.message}`);
      } else {
        setDomains((domainResult.data || []) as ClientDomainRow[]);
      }
    }

    setLoading(false);
  }

  async function updateEmail() {
    if (!supabase) return;
    const cleanEmail = newEmail.trim().toLowerCase();

    if (!cleanEmail || cleanEmail === email.toLowerCase()) {
      setError("Enter a different valid email address.");
      return;
    }

    setSavingEmail(true);
    setMessage("");
    setError("");

    const result = await supabase.auth.updateUser({ email: cleanEmail });
    setSavingEmail(false);

    if (result.error) {
      setError(`Email update failed: ${result.error.message}`);
      return;
    }

    setMessage("Email change requested. Check both inboxes if Supabase requires confirmation.");
  }

  async function updatePassword() {
    if (!supabase) return;

    if (newPassword.length < 10) {
      setError("Use a password with at least 10 characters.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("The password confirmation does not match.");
      return;
    }

    setSavingPassword(true);
    setMessage("");
    setError("");

    const result = await supabase.auth.updateUser({ password: newPassword });
    setSavingPassword(false);

    if (result.error) {
      setError(`Password update failed: ${result.error.message}`);
      return;
    }

    setNewPassword("");
    setConfirmPassword("");
    setMessage("Password updated successfully.");
  }

  return (
    <main className="nxq-page">
      <section className="portal-shell">
        <div className="panel-title panel-title-row">
          <div className="panel-title">
            <Save size={22} />
            <div>
              <h1>Client settings</h1>
              <p className="subtle">Manage your account, appearance, and connected domain details.</p>
            </div>
          </div>
          <a className="icon-btn" href="/client">
            <ArrowLeft size={16} /> Back to portal
          </a>
        </div>

        {error ? <div className="auth-error">{error}</div> : null}
        {message ? <div className="auth-success">{message}</div> : null}
        {loading ? <div className="empty-state">Loading settings...</div> : null}

        {!loading ? (
          <div className="owner-detail-grid">
            <section className="panel">
              <div className="panel-title">
                {theme === "dark" ? <Moon size={20} /> : <Sun size={20} />}
                <div>
                  <h2>Appearance</h2>
                  <p className="subtle">Choose the portal theme saved on this device.</p>
                </div>
              </div>
              <button
                className="wide-btn"
                type="button"
                onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
              >
                {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
                Switch to {theme === "dark" ? "light" : "dark"} mode
              </button>
            </section>

            <section className="panel">
              <div className="panel-title">
                <Mail size={20} />
                <div>
                  <h2>Email</h2>
                  <p className="subtle">Current login: {email || "Not available"}</p>
                </div>
              </div>
              <label>
                New email address
                <input
                  type="email"
                  value={newEmail}
                  onChange={(event) => setNewEmail(event.target.value)}
                  autoComplete="email"
                />
              </label>
              <button className="wide-btn" type="button" disabled={savingEmail} onClick={() => void updateEmail()}>
                <Mail size={16} /> {savingEmail ? "Requesting change..." : "Change email"}
              </button>
            </section>

            <section className="panel">
              <div className="panel-title">
                <KeyRound size={20} />
                <div>
                  <h2>Password</h2>
                  <p className="subtle">Use at least 10 characters and avoid reused passwords.</p>
                </div>
              </div>
              <label>
                New password
                <input
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  autoComplete="new-password"
                />
              </label>
              <label>
                Confirm new password
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  autoComplete="new-password"
                />
              </label>
              <button className="wide-btn" type="button" disabled={savingPassword} onClick={() => void updatePassword()}>
                <KeyRound size={16} /> {savingPassword ? "Updating password..." : "Change password"}
              </button>
            </section>

            <section className="panel">
              <div className="panel-title">
                <Globe2 size={20} />
                <div>
                  <h2>Domain management</h2>
                  <p className="subtle">Connected and pending domains for this client workspace.</p>
                </div>
              </div>

              {domains.length === 0 ? (
                <div className="empty-state">No domain request has been submitted yet.</div>
              ) : (
                domains.map((domain) => (
                  <div className="owner-message-card" key={domain.id}>
                    <strong>{domain.domain_name}</strong>
                    <small>Status: {domain.status.replaceAll("_", " ")}</small>
                  </div>
                ))
              )}

              <a className="wide-btn" href="/client#domain-management">
                <Globe2 size={16} /> Open domain management
              </a>
            </section>
          </div>
        ) : null}
      </section>
    </main>
  );
}
