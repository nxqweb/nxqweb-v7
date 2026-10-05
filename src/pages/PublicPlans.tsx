import { ArrowLeft, ArrowRight, Clock3 } from "lucide-react";
import { ProductFamilySignupSelector } from "../components/ProductFamilySignupSelector";
import { productTiers } from "../lib/productCatalog";
import { usePremiumRoot, usePointerSpotlight, useScrollReveal } from "../lib/premiumMotion";
import { usePageWipe } from "../lib/usePageWipe";

export function PublicPlans() {
  usePremiumRoot();
  useScrollReveal();
  usePointerSpotlight();
  usePageWipe();

  return (
    <main className="px">
      <header className="px-nav" aria-label="Primary">
        <a className="px-brand" href="/" aria-label="NXQX NXQX-Web home">
          <span className="px-mark">N</span>
          <span className="px-brandtext">
            <strong>NXQX</strong>
            <span>Web systems</span>
          </span>
        </a>
        <nav className="px-links" aria-label="Main navigation">
          <a href="/"><ArrowLeft size={16} /> Back home</a>
          <a className="px-cta" data-px-wipe href="/portal">Client portal</a>
        </nav>
      </header>

      <section className="px-sec-glass">
        <div className="px-wrap">
          <ProductFamilySignupSelector />
        </div>
      </section>

      <section id="tiers">
        <div className="px-wrap">
          <span className="px-kicker" data-px-reveal>Service tiers</span>
          <h2 data-px-reveal>Four clear service levels, from a polished managed site to a custom growth system.</h2>
          <p className="px-sub" data-px-reveal>
            Product families define the kind of website experience your business needs. Tiers define the level of ongoing service, growth, measurement, and optimization.
          </p>
          <div className="px-tiers">
            {productTiers.map((tier) => {
              const featured = tier.key === "growth";
              return (
                <article className={`px-tier ${featured ? "px-featured" : ""}`} data-px-reveal data-px-spot key={tier.key}>
                  <span className="px-badge">{tier.badge}</span>
                  <h3>{tier.name}</h3>
                  <p>{tier.description}</p>
                  <div className="px-price">{tier.priceLabel}</div>
                  <ul>
                    {tier.features.map((feature) => <li key={feature}>{feature}</li>)}
                  </ul>
                  <div className="px-out">{tier.outcome}</div>
                  <a
                    className={`px-btn ${featured ? "px-gold" : "px-ghost"}`}
                    data-px-wipe
                    href={`/portal/signup?family=business&tier=${tier.key}`}
                  >
                    Choose {tier.name} <ArrowRight size={16} />
                  </a>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <div className="px-wrap">
        <div className="px-cta-band" data-px-reveal>
          <Clock3 size={26} />
          <h2>More NXQX-Web systems are on the way.</h2>
          <p className="px-sub">Planned families stay visible so you can see what is coming, but signup stays closed until each experience is ready for clients.</p>
          <p className="px-sub">
            Coming next: NXQX-Booking, NXQX-Commerce, NXQX-Menu, NXQX-Property, NXQX-Multi-Location, NXQX-Membership, and NXQX-Enterprise.
          </p>
          <div className="px-btns">
            <a className="px-btn px-gold" data-px-wipe href="/portal/signup?family=business&tier=growth">
              Start NXQX-Business <ArrowRight size={16} />
            </a>
          </div>
        </div>
      </div>

      <footer>
        <div className="px-wrap px-foot">
          <span>NXQX · NXQX-Web</span>
          <span>Premium managed website systems</span>
        </div>
      </footer>
    </main>
  );
}
