import { ArrowRight, LockKeyhole } from "lucide-react";

export function PortalLogin() {
  return (
    <main className="nxq-page">
      <section className="portal-shell portal-auth-shell">
        <a className="badge" href="/portal">
          Client Portal
        </a>

        <div className="auth-card">
          <div className="panel-title">
            <LockKeyhole size={22} />
            <h1>Log in</h1>
          </div>

          <p className="subtle">
            This is the client portal login screen. Supabase email/password
            authentication will connect in the next phase.
          </p>

          <label className="auth-label" htmlFor="email">
            Email
          </label>
          <input
            className="auth-input"
            id="email"
            placeholder="client@example.com"
            type="email"
          />

          <label className="auth-label" htmlFor="password">
            Password
          </label>
          <input
            className="auth-input"
            id="password"
            placeholder="••••••••"
            type="password"
          />

          <button className="primary-btn auth-submit" type="button">
            Log in to portal
            <ArrowRight size={18} />
          </button>

          <p className="auth-note">
            Need access? <a href="/portal/signup">Create an account</a>
          </p>
        </div>
      </section>
    </main>
  );
}

