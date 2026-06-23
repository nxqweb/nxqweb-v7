import { ArrowRight, LockKeyhole, Sparkles } from "lucide-react";

export function PortalLanding() {
  return (
    <main className="nxq-page">
      <section className="portal-shell portal-auth-shell">
        <a className="badge" href="/">
          NXQ Web
        </a>

        <div className="auth-card">
          <div className="panel-title">
            <Sparkles size={22} />
            <h1>Client Portal</h1>
          </div>

          <p className="hero-copy">
            Access your NXQ Web project workspace, messages, files, approvals,
            and launch updates from one secure portal.
          </p>

          <div className="auth-actions">
            <a className="primary-btn" href="/portal/login">
              Log in
              <ArrowRight size={18} />
            </a>

            <a className="secondary-btn" href="/portal/signup">
              Create account
            </a>
          </div>

          <div className="history-item">
            <LockKeyhole size={16} />
            <p>
              Email verification and protected client access will connect in the
              next phase.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}

