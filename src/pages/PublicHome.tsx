import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Crown,
  Gem,
  ShieldCheck,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import { ProductFamilySignupSelector } from "../components/ProductFamilySignupSelector";
import { productTiers } from "../lib/productCatalog";

export function PublicHome() {
  return (
    <main className="lux-home">
      <section className="lux-page">
        <header className="lux-nav lux-card">
          <a className="lux-brand" href="/">
            <div className="lux-logo">N</div>
            <div>
              <strong>NXQX</strong>
              <span>NXQ-Web</span>
            </div>
          </a>

          <nav className="lux-links" aria-label="Main navigation">
            <a href="#systems">Systems</a>
            <a href="#pricing">Pricing</a>
            <a href="#process">Process</a>
            <a className="lux-nav-portal" href="/portal">
              Client portal
            </a>
          </nav>
        </header>

        <section className="lux-hero">
          <div className="lux-hero-copy">
            <div className="lux-tag">
              <Crown size={16} />
              premium managed website systems
            </div>

            <h1>
              Your website should work
              <span>as hard as your business.</span>
            </h1>

            <p>
              NXQ-Web builds, manages, improves, and grows premium websites for businesses that do not want to babysit technology. You get a polished website, a client portal, clear project controls, and an ongoing system built around your goals.
            </p>

            <div className="lux-actions">
              <a className="lux-btn lux-btn-primary" href="/portal/signup?family=business&tier=growth">
                Build my website
                <ArrowRight size={18} />
              </a>

              <a className="lux-btn lux-btn-secondary" href="#systems">
                See how NXQ works
              </a>
            </div>
          </div>

          <aside className="lux-card lux-preview" aria-label="NXQ-Web system preview">
            <div className="lux-browser">
              <div className="lux-dots">
                <span />
                <span />
                <span />
              </div>

              <div className="lux-inner-panel">
                <small>managed website system</small>
                <h2>Build. Grow. Convert. Maintain.</h2>
                <p>
                  One premium website operation that keeps client intake, project approvals, updates, leads, optimization, and maintenance organized around the same workspace.
                </p>

                <div className="lux-mini-grid">
                  <div>Premium build</div>
                  <div>Growth system</div>
                  <div>Client control</div>
                </div>
              </div>
            </div>
          </aside>
        </section>

        <section className="lux-section" id="systems">
          <div className="lux-section-head">
            <span>One system. Your website operation.</span>
            <h2>A premium site is only the beginning.</h2>
            <p>
              NXQ-Web is designed around the full lifecycle: getting a business online, helping customers find it, converting attention into leads, and keeping the site current over time.
            </p>
          </div>

          <div className="lux-grid">
            <article className="lux-card lux-service">
              <Gem size={26} />
              <h3>Build</h3>
              <p>Premium responsive websites with clean structure, professional presentation, secure client access, and a managed launch process.</p>
            </article>

            <article className="lux-card lux-service">
              <WandSparkles size={26} />
              <h3>Grow</h3>
              <p>Local SEO structure, service-area content, stronger calls to action, ongoing content improvements, and better visibility.</p>
            </article>

            <article className="lux-card lux-service">
              <BarChart3 size={26} />
              <h3>Optimize</h3>
              <p>Higher tiers add behavior insights, conversion review, performance analysis, and an ongoing improvement cycle instead of a website that sits still.</p>
            </article>
          </div>
        </section>

        <section className="lux-section">
          <ProductFamilySignupSelector />
        </section>

        <section className="lux-section" id="pricing">
          <div className="lux-section-head">
            <span>Pricing</span>
            <h2>Pick where you want your business to go.</h2>
            <p>
              Every tier keeps the same managed foundation. Higher tiers add more visibility, measurement, and ongoing optimization rather than simply adding random features.
            </p>
          </div>

          <div className="lux-grid lux-pricing-grid">
            {productTiers.map((tier) => {
              const featured = tier.key === "growth";
              return (
                <article className={`lux-card lux-price ${featured ? "lux-featured" : ""}`} key={tier.key}>
                  <span className="lux-plan-badge">{tier.badge}</span>
                  <h3>{tier.name}</h3>
                  <p>{tier.description}</p>
                  <strong>{tier.priceLabel}</strong>
                  <ul className="lux-plan-list">
                    {tier.features.map((feature) => (
                      <li key={feature}>{feature}</li>
                    ))}
                  </ul>
                  <small>{tier.outcome}</small>
                  <a
                    className={`lux-btn ${featured ? "lux-btn-primary" : "lux-btn-secondary"}`}
                    href={`/portal/signup?family=business&tier=${encodeURIComponent(tier.key)}`}
                  >
                    Choose {tier.name}
                    <ArrowRight size={17} />
                  </a>
                </article>
              );
            })}
          </div>
        </section>

        <section className="lux-card lux-process" id="process">
          <div>
            <span className="lux-kicker">Managed process</span>
            <h2>Choose. Tell us about the business. Review. Launch.</h2>
          </div>

          <div className="lux-checks">
            <div><CheckCircle2 size={18} /> Choose the NXQ family and service tier</div>
            <div><CheckCircle2 size={18} /> Complete a form matched to that selection</div>
            <div><CheckCircle2 size={18} /> NXQ reviews the project before infrastructure is created</div>
            <div><CheckCircle2 size={18} /> Approved projects move through the managed build and launch workflow</div>
          </div>
        </section>

        <section className="lux-card lux-final">
          <div>
            <Sparkles size={26} />
            <h2>Stop treating your website like a one-time project.</h2>
            <p>
              Choose the system and tier that fit your business. NXQ-Web keeps the website, project workflow, updates, and growth work connected after launch.
            </p>
          </div>

          <a className="lux-btn lux-btn-primary" href="/portal/signup?family=business&tier=growth">
            Start with NXQ-Business
            <ArrowRight size={18} />
          </a>
        </section>

        <section className="lux-section" aria-label="Security and control note">
          <div className="lux-card lux-service">
            <ShieldCheck size={24} />
            <h3>Owner-controlled where it matters.</h3>
            <p>Project approval and other high-impact decisions remain reviewed before they move forward. The redesign does not remove the existing approval or security boundaries.</p>
          </div>
        </section>
      </section>
    </main>
  );
}
