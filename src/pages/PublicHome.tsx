import {
  Activity,
  ArrowRight,
  BarChart3,
  Building2,
  CheckCircle2,
  Crown,
  Gem,
  MousePointerClick,
  Search,
  ShieldCheck,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import { ProductFamilySignupSelector } from "../components/ProductFamilySignupSelector";
import { productTiers } from "../lib/productCatalog";

const comparisonRows = [
  { label: "Premium managed website", starter: "Included", growth: "Included", intelligence: "Included", enterprise: "Included" },
  { label: "Local SEO foundation", starter: "Basic", growth: "Expanded", intelligence: "Advanced", enterprise: "Custom" },
  { label: "Lead + conversion focus", starter: "Core", growth: "Expanded", intelligence: "Advanced", enterprise: "Custom" },
  { label: "Behavior analytics", starter: "—", growth: "Core analytics", intelligence: "Click + scroll", enterprise: "Custom" },
  { label: "Ongoing optimization", starter: "Maintenance", growth: "Monthly", intelligence: "Priority cycle", enterprise: "Custom cadence" },
  { label: "Multi-location scale", starter: "—", growth: "—", intelligence: "—", enterprise: "Available" },
];

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
            <a className="lux-nav-portal" href="/portal">Client portal</a>
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
              NXQ-Web builds, manages, improves, and grows premium websites for businesses that do not want to babysit technology. Your site, client portal, updates, growth work, and ongoing care stay connected in one managed system.
            </p>

            <div className="lux-actions">
              <a className="lux-btn lux-btn-primary" href="/portal/signup?family=business&tier=growth">
                Build my website
                <ArrowRight size={18} />
              </a>
              <a className="lux-btn lux-btn-secondary" href="#systems">See how NXQ works</a>
            </div>

            <div className="lux-hero-proof" aria-label="NXQ-Web service principles">
              <span><ShieldCheck size={15} /> Managed after launch</span>
              <span><Activity size={15} /> Built to keep improving</span>
              <span><CheckCircle2 size={15} /> Owner-reviewed where it matters</span>
            </div>
          </div>

          <aside className="lux-card lux-preview" aria-label="NXQ-Web system preview">
            <div className="lux-browser">
              <div className="lux-browser-topline">
                <div className="lux-dots"><span /><span /><span /></div>
                <span>NXQ-Web live workspace</span>
              </div>

              <div className="lux-inner-panel">
                <small>managed website system</small>
                <h2>Build. Grow. Convert. Maintain.</h2>
                <p>
                  One premium website operation that keeps intake, approvals, content, leads, optimization, and maintenance organized around the same client workspace.
                </p>

                <div className="lux-mini-grid">
                  <div><Gem size={17} /> Premium build</div>
                  <div><Search size={17} /> Growth system</div>
                  <div><MousePointerClick size={17} /> Conversion focus</div>
                </div>

                <div className="lux-preview-status">
                  <span>Website health</span>
                  <strong>Managed</strong>
                  <div><i /><i /><i /><i /></div>
                </div>
              </div>
            </div>
          </aside>
        </section>

        <section className="lux-trust-strip lux-card" aria-label="What NXQ-Web manages">
          <span>Premium design</span>
          <span>Hosting + SSL</span>
          <span>Client portal</span>
          <span>SEO foundation</span>
          <span>Lead capture</span>
          <span>Ongoing care</span>
        </section>

        <section className="lux-section" id="systems">
          <div className="lux-section-head">
            <span>One system. Your website operation.</span>
            <h2>A premium site is only the beginning.</h2>
            <p>
              NXQ-Web is designed around the full lifecycle: getting your business online, helping customers find it, turning attention into leads, and keeping the site current instead of letting it age in place.
            </p>
          </div>

          <div className="lux-grid lux-lifecycle-grid">
            <article className="lux-card lux-service">
              <div className="lux-step-number">01</div>
              <Gem size={26} />
              <h3>Build</h3>
              <p>Premium responsive presentation, secure client access, clear structure, and a managed setup process.</p>
            </article>
            <article className="lux-card lux-service">
              <div className="lux-step-number">02</div>
              <Search size={26} />
              <h3>Get found</h3>
              <p>SEO foundations, service-area structure, stronger pages, and ongoing content opportunities.</p>
            </article>
            <article className="lux-card lux-service">
              <div className="lux-step-number">03</div>
              <MousePointerClick size={26} />
              <h3>Convert</h3>
              <p>Lead capture, stronger calls to action, conversion-focused layouts, and clearer customer paths.</p>
            </article>
            <article className="lux-card lux-service">
              <div className="lux-step-number">04</div>
              <Activity size={26} />
              <h3>Improve</h3>
              <p>Higher tiers add behavior insights, performance review, and an ongoing optimization cycle.</p>
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
              Every tier keeps the managed foundation. Higher tiers add stronger visibility, measurement, and ongoing optimization instead of random feature clutter.
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
                    {tier.features.map((feature) => <li key={feature}>{feature}</li>)}
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

          <div className="lux-card lux-comparison-wrap">
            <div className="lux-comparison-head">
              <div>
                <span className="lux-kicker">Compare the outcome</span>
                <h3>See what changes as NXQ-Web takes on more of the growth work.</h3>
              </div>
              <a className="lux-btn lux-btn-secondary" href="/plans">Open full plans</a>
            </div>

            <div className="lux-comparison-table" role="table" aria-label="NXQ-Web tier comparison">
              <div className="lux-comparison-row lux-comparison-labels" role="row">
                <strong role="columnheader">Capability</strong>
                <strong role="columnheader">Starter</strong>
                <strong role="columnheader">Growth</strong>
                <strong role="columnheader">Intelligence</strong>
                <strong role="columnheader">Enterprise</strong>
              </div>
              {comparisonRows.map((row) => (
                <div className="lux-comparison-row" role="row" key={row.label}>
                  <span role="cell">{row.label}</span>
                  <span role="cell">{row.starter}</span>
                  <span role="cell">{row.growth}</span>
                  <span role="cell">{row.intelligence}</span>
                  <span role="cell">{row.enterprise}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="lux-section" id="process">
          <div className="lux-section-head">
            <span>How NXQ-Web works</span>
            <h2>Simple for the client. Controlled behind the scenes.</h2>
            <p>The client gets a clean guided experience while project approval and higher-impact decisions stay protected.</p>
          </div>

          <div className="lux-process-track">
            <article className="lux-card lux-process-step">
              <span>01</span>
              <Building2 size={23} />
              <h3>Choose</h3>
              <p>Select the website family and service tier that match the business.</p>
            </article>
            <article className="lux-card lux-process-step">
              <span>02</span>
              <WandSparkles size={23} />
              <h3>Tell us what matters</h3>
              <p>Complete a project form that changes based on the selected family and tier.</p>
            </article>
            <article className="lux-card lux-process-step">
              <span>03</span>
              <ShieldCheck size={23} />
              <h3>Review</h3>
              <p>NXQ reviews the setup before protected build automation can move forward.</p>
            </article>
            <article className="lux-card lux-process-step">
              <span>04</span>
              <Sparkles size={23} />
              <h3>Build + launch</h3>
              <p>Approved projects move through the managed website workflow and ongoing care path.</p>
            </article>
          </div>
        </section>

        <section className="lux-card lux-value-panel">
          <div className="lux-value-copy">
            <span className="lux-kicker">Why managed beats DIY</span>
            <h2>Your time should go into the business, not babysitting a website builder.</h2>
            <p>
              DIY tools can help create pages. NXQ-Web is designed around the work that comes after that too: structure, client intake, updates, SEO, lead flow, monitoring, reports, and ongoing improvements.
            </p>
          </div>
          <div className="lux-value-grid">
            <div><Gem size={20} /><strong>Premium presentation</strong><span>Built to feel intentional instead of template-random.</span></div>
            <div><BarChart3 size={20} /><strong>Growth visibility</strong><span>Higher tiers add deeper insight and optimization.</span></div>
            <div><ShieldCheck size={20} /><strong>Managed control</strong><span>High-impact steps stay reviewed before moving forward.</span></div>
            <div><Activity size={20} /><strong>Ongoing care</strong><span>The website remains part of an active system after launch.</span></div>
          </div>
        </section>

        <section className="lux-card lux-final">
          <div>
            <Sparkles size={26} />
            <h2>Stop treating your website like a one-time project.</h2>
            <p>Choose the system and tier that fit your business. NXQ-Web keeps the website, project workflow, updates, and growth work connected after launch.</p>
          </div>
          <a className="lux-btn lux-btn-primary" href="/portal/signup?family=business&tier=growth">
            Start with NXQ-Business
            <ArrowRight size={18} />
          </a>
        </section>
      </section>
    </main>
  );
}
