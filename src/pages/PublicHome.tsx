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
            <h2>Premium websites. Smarter monthly plans.</h2>
            <p>
              Start with the plan that matches where your business is right now.
              As your company grows, your website system can grow with stronger SEO,
              smarter insights, and deeper monthly optimization.
            </p>
          </div>

          <div className="lux-grid lux-pricing-grid">
            <article className="lux-card lux-price">
              <span className="lux-plan-badge">Best Entry</span>
              <h3>Starter</h3>
              <p>
                Premium website essentials for small businesses that need to look
                trusted, professional, and ready for customers online.
              </p>
              <strong>$50/mo</strong>
              <ul className="lux-plan-list">
                <li>Premium 1–3 page website</li>
                <li>Mobile-responsive design</li>
                <li>Basic SEO setup</li>
                <li>Contact form</li>
                <li>Simple client portal access</li>
                <li>Manual update requests</li>
              </ul>
              <small>Best for new businesses, solo owners, and simple local services.</small>
            </article>

            <article className="lux-card lux-price lux-featured">
              <span className="lux-plan-badge">Most Popular</span>
              <h3>Growth</h3>
              <p>
                A stronger SEO-focused website system for businesses that want
                more visibility, better structure, and more leads.
              </p>
              <strong>$100/mo</strong>
              <ul className="lux-plan-list">
                <li>Everything in Starter</li>
                <li>Up to 5 core pages</li>
                <li>Service-area SEO sections</li>
                <li>Monthly website/content improvements</li>
                <li>Review and testimonial sections</li>
                <li>AI-assisted SEO/content suggestions</li>
              </ul>
              <small>Best for contractors, tree services, cleaning companies, and local teams.</small>
            </article>

            <article className="lux-card lux-price">
              <span className="lux-plan-badge">Most Advanced</span>
              <h3>Intelligence</h3>
              <p>
                AI-powered website optimization with behavior insights, monthly
                improvement recommendations, and conversion-focused planning.
              </p>
              <strong>$150/mo</strong>
              <ul className="lux-plan-list">
                <li>Everything in Growth</li>
                <li>Click and scroll insights</li>
                <li>Page interaction review</li>
                <li>Monthly AI website review</li>
                <li>Layout improvement suggestions</li>
                <li>Conversion-focused optimization notes</li>
              </ul>
              <small>Best for businesses serious about leads, growth, and long-term performance.</small>
            </article>

            <article className="lux-card lux-price">
              <span className="lux-plan-badge">Custom</span>
              <h3>Enterprise</h3>
              <p>
                Custom website systems for larger companies, multi-location
                businesses, and teams that need advanced workflows.
              </p>
              <strong>Custom</strong>
              <ul className="lux-plan-list">
                <li>Multi-location SEO</li>
                <li>Location-specific pages</li>
                <li>Advanced reporting</li>
                <li>Custom approval workflows</li>
                <li>Priority project support</li>
                <li>Custom integrations later</li>
              </ul>
              <small>Best for regional service companies, forestry teams, and larger operations.</small>
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

