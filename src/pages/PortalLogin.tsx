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

    const { error } = await supabase.auth.signInWithPassword({
      email: trimmedEmail,
      password,
    });

    setIsSubmitting(false);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    setStatusMessage("Login successful. Opening your client portal...");
    window.location.href = "/client";
  }

  return (
    <main className="nxq-page">
      <section className="portal-shell portal-auth-shell">
        <a className="badge" href="/portal">
          Client Portal
        </a>

        <form className="auth-card" onSubmit={handleLogin}>
          <div className="panel-title">
            <LockKeyhole size={22} />
            <h1>Log in</h1>
          </div>

          <p className="subtle">
            Log in with the email and password connected to your NXQ Web client
            portal.
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
            placeholder="client@example.com"
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
            {isSubmitting ? "Logging in..." : "Log in to portal"}
            <ArrowRight size={18} />
          </button>

          <p className="auth-note">
            Need access? <a href="/portal/signup">Create an account</a>
          </p>
        </form>
      </section>
    </main>
  );
}
