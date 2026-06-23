import { MailCheck, UserPlus } from "lucide-react";

export function PortalSignup() {
  return (
    <main className="nxq-page">
      <section className="portal-shell portal-auth-shell">
        <a className="badge" href="/portal">
          Client Portal
        </a>

        <div className="auth-card">
          <div className="panel-title">
            <UserPlus size={22} />
            <h1>Create account</h1>
          </div>

          <p className="subtle">
            Create your NXQ Web client portal account. Email verification will
            be required before portal access once auth is connected.
          </p>

          <label className="auth-label" htmlFor="signup-email">
            Email
          </label>
          <input
            className="auth-input"
            id="signup-email"
            placeholder="client@example.com"
            type="email"
          />

          <label className="auth-label" htmlFor="signup-password">
            Password
          </label>
          <input
            className="auth-input"
            id="signup-password"
            placeholder="Create a secure password"
            type="password"
          />

          <button className="primary-btn auth-submit" type="button">
            Create account
            <MailCheck size={18} />
          </button>

          <p className="auth-note">
            Already have an account? <a href="/portal/login">Log in</a>
          </p>
        </div>
      </section>
    </main>
  );
}

