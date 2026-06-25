import { useState } from "react";
import { ArrowRight, LockKeyhole } from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

export function PortalLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedEmail = email.trim();

    setStatusMessage("");
    setErrorMessage("");

    if (!isSupabaseConfigured || !supabase) {
      setErrorMessage("Supabase is not configured yet. Check .env.local.");
      return;
    }

    if (!trimmedEmail || !password) {
      setErrorMessage("Enter your email and password.");
      return;
    }

    setIsSubmitting(true);

    const { data, error } = await supabase.auth.signInWithPassword({
      email: trimmedEmail,
      password,
    });

    if (error || !data.user) {
      setIsSubmitting(false);
      setErrorMessage(error?.message || "Login failed.");
      return;
    }

    const ownerResult = await supabase
      .from("owner_users")
      .select("id, role")
      .eq("auth_user_id", data.user.id)
      .maybeSingle();

    if (ownerResult.error) {
      setIsSubmitting(false);
      await supabase.auth.signOut();
      setErrorMessage(`Owner access check failed: ${ownerResult.error.message}`);
      return;
    }

    if (ownerResult.data) {
      setStatusMessage("Owner account verified. Opening Owner APS...");
      window.location.href = "/owner";
      return;
    }

    const clientResult = await supabase
      .from("clients")
      .select("id, business_name")
      .eq("auth_user_id", data.user.id)
      .maybeSingle();

    setIsSubmitting(false);

    if (clientResult.error) {
      await supabase.auth.signOut();
      setErrorMessage(`Client access check failed: ${clientResult.error.message}`);
      return;
    }

    if (clientResult.data) {
      setStatusMessage("Client account verified. Opening your client portal...");
      window.location.href = "/client";
      return;
    }

    await supabase.auth.signOut();
    setErrorMessage(
      "This login exists, but it is not linked to an NXQ owner or client profile yet."
    );
  }

  return (
    <main className="nxq-page">
      <section className="portal-shell portal-auth-shell">
        <a className="badge" href="/portal">
          NXQ Web Portal
        </a>

        <form className="auth-card" onSubmit={handleLogin}>
          <div className="panel-title">
            <LockKeyhole size={22} />
            <h1>Log in</h1>
          </div>

          <p className="subtle">
            Use your NXQ Web email and password. Owner accounts open Owner APS;
            client accounts open the Client Portal.
          </p>

          {errorMessage ? <div className="auth-error">{errorMessage}</div> : null}
          {statusMessage ? <div className="auth-success">{statusMessage}</div> : null}

          <label className="auth-label" htmlFor="email">
            Email
          </label>
          <input
            className="auth-input"
            id="email"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            type="email"
            value={email}
          />

          <label className="auth-label" htmlFor="password">
            Password
          </label>
          <input
            className="auth-input"
            id="password"
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Enter your password"
            type="password"
            value={password}
          />

          <button className="primary-btn auth-submit" disabled={isSubmitting} type="submit">
            {isSubmitting ? "Checking access..." : "Log in to portal"}
            <ArrowRight size={18} />
          </button>

          <p className="auth-note">
            Need client access? <a href="/portal/signup">Create an account</a>
          </p>
        </form>
      </section>
    </main>
  );
}
