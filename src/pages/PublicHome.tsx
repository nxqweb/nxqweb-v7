import {
  ArrowRight,
  Bot,
  CheckCircle2,
  Crown,
  Gem,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

export function PublicHome() {
  return (
    <main className="lux-home">
      <section className="lux-page">
        <header className="lux-nav lux-card">
          <a className="lux-brand" href="/">
            <div className="lux-logo">N</div>
            <div>
              <strong>NXQ</strong>
              <span>web systems</span>
            </div>
          </a>

          <nav className="lux-links" aria-label="Main navigation">
            <a href="/">Home</a>
            <a href="#pricing">Pricing</a>
            <a href="#process">Process</a>
            <a className="lux-nav-portal" href="/portal">
              Portal
            </a>
          </nav>
        </header>

        <section className="lux-hero">
          <div className="lux-hero-copy">
            <div className="lux-tag">
              <Crown size={16} />
              premium AI website agency
            </div>

            <h1>
              Websites that make small businesses feel
              <span> expensive.</span>
            </h1>

            <p>
              NXQ Web builds premium monthly websites with client portals, owner
              approval controls, AI-assisted workflows, and clean systems that
              help businesses look sharper, move faster, and stay organized.
            </p>

            <div className="lux-actions">
              <a className="lux-btn lux-btn-primary" href="/portal">
                Client Portal
                <ArrowRight size={18} />
              </a>

              <a className="lux-btn lux-btn-secondary" href="#pricing">
                View pricing
              </a>
            </div>
          </div>

          <aside className="lux-card lux-preview" aria-label="NXQ preview">
            <div className="lux-browser">
              <div className="lux-dots">
                <span />
                <span />
                <span />
              </div>

              <div className="lux-inner-panel">
                <small>live system preview</small>
                <h2>Client portal, owner approvals, and AI workflow in one place.</h2>
                <p>
                  Clear cards, gold edges, secure client access, owner approvals,
                  project updates, messages, and launch tracking.
                </p>

                <div className="lux-mini-grid">
                  <div>Client Portal</div>
                  <div>Owner APS</div>
                  <div>AI Workflow</div>
                </div>
              </div>
            </div>
          </aside>
        </section>

        <section className="lux-section" id="services">
          <div className="lux-section-head">
            <span>What NXQ Web does</span>
            <h2>Premium websites backed by real workflow systems.</h2>
          </div>

          <div className="lux-grid">
            <article className="lux-card lux-service">
              <Gem size={26} />
              <h3>Premium websites</h3>
              <p>
                Clean, cinematic, mobile-ready websites designed to make small
                businesses look high-trust and professional.
              </p>
            </article>

            <article className="lux-card lux-service">
              <Bot size={26} />
              <h3>AI-managed workflow</h3>
              <p>
                AI helps collect info, prepare updates, organize requests, and
                route important actions for owner approval.
              </p>
            </article>

            <article className="lux-card lux-service">
              <ShieldCheck size={26} />
              <h3>Approval gates</h3>
              <p>
                High-risk actions like accepting clients, launching, freezing,
                and major changes stay under owner control.
              </p>
            </article>
          </div>
        </section>

        <section className="lux-section" id="pricing">
          <div className="lux-section-head">
            <span>Pricing</span>
            <h2>Simple monthly plans clients can actually say yes to.</h2>
          </div>

          <div className="lux-grid">
            <article className="lux-card lux-price">
              <h3>Starter</h3>
              <p>Clean website, portal access, basic updates, and launch support.</p>
              <strong>$50/mo</strong>
            </article>

            <article className="lux-card lux-price lux-featured">
              <h3>Growth</h3>
              <p>More pages, stronger support, better workflow, and active updates.</p>
              <strong>$100/mo</strong>
            </article>

            <article className="lux-card lux-price">
              <h3>Premium</h3>
              <p>Priority support, deeper AI help, premium polish, and more updates.</p>
              <strong>$150/mo</strong>
            </article>
          </div>
        </section>

        <section className="lux-card lux-process" id="process">
          <div>
            <span className="lux-kicker">Process</span>
            <h2>From website request to launch, without the messy admin chaos.</h2>
          </div>

          <div className="lux-checks">
            <div>
              <CheckCircle2 size={18} />
              Client enters portal
            </div>
            <div>
              <CheckCircle2 size={18} />
              AI organizes the request
            </div>
            <div>
              <CheckCircle2 size={18} />
              Owner approves key moves
            </div>
            <div>
              <CheckCircle2 size={18} />
              Website moves toward launch
            </div>
          </div>
        </section>

        <section className="lux-card lux-final">
          <div>
            <Sparkles size={26} />
            <h2>Ready to access your website project?</h2>
            <p>
              Clients can enter the NXQ Web portal to message NXQ, review project
              updates, and manage website content.
            </p>
          </div>

          <a className="lux-btn lux-btn-primary" href="/portal">
            Open portal
            <ArrowRight size={18} />
          </a>
        </section>
      </section>
    </main>
  );
}
