import { ArrowLeft, ArrowRight, Clock3 } from "lucide-react";
import { ProductFamilySignupSelector } from "../components/ProductFamilySignupSelector";
import { productTiers } from "../lib/productCatalog";

export function PublicPlans() {
  return (
    <main className="lux-home">
      <section className="lux-page">
        <div className="lux-nav lux-card">
          <a className="lux-brand" href="/">
            <div className="lux-logo">N</div>
            <div>
              <strong>NXQX</strong>
              <span>NXQ-Web systems</span>
            </div>
          </a>
          <a className="lux-btn lux-btn-secondary" href="/">
            <ArrowLeft size={16} /> Back home
          </a>
        </div>

        <section className="lux-section">
          <div className="lux-section-head">
            <span>NXQ-Web systems</span>
            <h2>Choose the website system first. Then choose how far you want it to go.</h2>
            <p>
              Product families define the kind of website experience your business needs. Tiers define the level of ongoing service, growth, measurement, and optimization.
            </p>
          </div>

          <ProductFamilySignupSelector />
        </section>

        <section className="lux-section" id="tiers">
          <div className="lux-section-head">
            <span>Service tiers</span>
            <h2>Four clear service levels, from a polished managed site to a custom growth system.</h2>
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
                  <a className={`lux-btn ${featured ? "lux-btn-primary" : "lux-btn-secondary"}`} href={`/portal/signup?family=business&tier=${tier.key}`}>
                    Choose {tier.name} <ArrowRight size={16} />
                  </a>
                </article>
              );
            })}
          </div>
        </section>

        <section className="lux-card lux-final">
          <div>
            <Clock3 size={24} />
            <h2>More NXQ-Web systems are on the way.</h2>
            <p>Planned families stay visible so you can see what is coming, but signup stays closed until each experience is ready for clients.</p>
          </div>
          <a className="lux-btn lux-btn-primary" href="/portal/signup?family=business&tier=growth">Start NXQ-Business <ArrowRight size={16} /></a>
        </section>
      </section>
    </main>
  );
}
