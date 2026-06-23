import { MailCheck } from "lucide-react";

export function CheckEmail() {
  return (
    <main className="nxq-page">
      <section className="portal-shell portal-auth-shell">
        <a className="badge" href="/">
          NXQ Web
        </a>

        <div className="auth-card">
          <div className="panel-title">
            <MailCheck size={22} />
            <h1>Check your email</h1>
          </div>

          <p className="hero-copy">
            We sent a verification link to your email. After verification, you
            will be able to access your NXQ Web client portal.
          </p>

          <div className="auth-actions">
            <a className="primary-btn" href="/portal/login">
              Back to login
            </a>

            <a className="secondary-btn" href="/">
              Return home
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}

