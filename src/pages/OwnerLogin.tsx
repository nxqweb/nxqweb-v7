import { useState } from "react";
import { ArrowRight, LockKeyhole } from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

export function OwnerLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleOwnerLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedEmail = email.trim();

    setStatusMessage("");
    setErrorMessage("");

    if (!isSupabaseConfigured || !supabase) {
      setErrorMessage("Supabase is not configured yet. Check .env.local.");
      return;
    }

    if (!trimmedEmail || !password) {
      setErrorMessage("Enter your owner email and password.");
      return;
    }

    setIsSubmitting(true);

    const { data, error } = await supabase.auth.signInWithPassword({
      email: trimmedEmail,
      password,
    });

    if (error || !data.user) {
      setIsSubmitting(false);
      setErrorMessage(error?.message || "Owner login failed.");
      return;
    }

    const ownerResult = await supabase
      .from("owner_users")
      .select("id, role")
      .eq("auth_user_id", data.user.id)
      .maybeSingle();

    setIsSubmitting(false);

    if (ownerResult.error) {
      setErrorMessage(`Owner check failed: ${ownerResult.error.message}`);
      return;
    }

    if (!ownerResult.data) {
      await supabase.auth.signOut();
      setErrorMessage("This login is not approved as an NXQ owner account.");
      return;
    }

    setStatusMessage("Owner login approved. Opening Owner APS...");
    window.location.href = "/owner";
  }

  return (
    <main className="nxq-page">
      <section className="portal-shell portal-auth-shell">
        <a className="badge" href="/">
          NXQ Owner
        </a>

        <form className="auth-card" onSubmit={handleOwnerLogin}>
          <div className="panel-title">
            <LockKeyhole size={22} />
            <h1>Owner login</h1>
          </div>

          <p className="subtle">
            Owner APS is restricted. Only approved NXQ owner accounts can access
            command controls, client approvals, and client messages.
          </p>

          {errorMessage ? <div className="auth-error">{errorMessage}</div> : null}
          {statusMessage ? <div className="auth-success">{statusMessage}</div> : null}

          <label className="auth-label" htmlFor="owner-email">
            Owner email
          </label>
          <input
            className="auth-input"
            id="owner-email"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="owner@example.com"
            type="email"
            value={email}
          />

          <label className="auth-label" htmlFor="owner-password">
            Password
          </label>
          <input
            className="auth-input"
            id="owner-password"
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Enter owner password"
            type="password"
            value={password}
          />

          <button className="primary-btn auth-submit" disabled={isSubmitting} type="submit">
            {isSubmitting ? "Checking owner access..." : "Log in to Owner APS"}
            <ArrowRight size={18} />
          </button>

          <p className="auth-note">
            Client account? <a href="/portal/login">Go to client login</a>
          </p>
        </form>
      </section>
    </main>
  );
}
