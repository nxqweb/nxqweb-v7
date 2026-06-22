import { ArrowRight, Bot, ShieldCheck, Sparkles } from "lucide-react";

export function PublicHome() {
  return (
    <main className="nxq-page">
      <section className="hero-shell">
        <div className="badge">
          <Sparkles size={16} />
          NXQ Web V7
        </div>

        <h1>AI-managed websites for small businesses.</h1>

        <p className="hero-copy">
          NXQ Web is being rebuilt as a cleaner AI-run web agency system:
          client portal, owner approval portal, Supabase backend, and AI workers
          that handle the boring stuff while the owner approves important moves.
        </p>

        <div className="hero-actions">
          <a href="/client" className="primary-btn">
            Client Portal
            <ArrowRight size={18} />
          </a>

          <a href="/owner" className="secondary-btn">
            Owner APS
          </a>
        </div>

        <div className="feature-grid">
          <article className="glass-card">
            <Bot size={24} />
            <h2>AI agency manager</h2>
            <p>Reviews intake, recommends packages, drafts replies, and creates owner approval requests.</p>
          </article>

          <article className="glass-card">
            <ShieldCheck size={24} />
            <h2>Owner approval gates</h2>
            <p>High-risk actions like accept, deny, freeze, launch, or payment status changes require approval.</p>
          </article>

          <article className="glass-card">
            <Sparkles size={24} />
            <h2>Simple portals</h2>
            <p>One owner portal. One client portal. No giant admin mess. Just the workflow that matters.</p>
          </article>
        </div>
      </section>
    </main>
  );
}
