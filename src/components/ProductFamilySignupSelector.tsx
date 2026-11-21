import { ArrowRight, Clock3, PhoneCall, Sparkles } from "lucide-react";
import {
  isPubliclySelectableFamily,
  productFamilyCatalog as PRODUCT_FAMILIES,
} from "../lib/productCatalog";

export function ProductFamilySignupSelector() {
  const visibleFamilies = PRODUCT_FAMILIES.filter((family) => family.status !== "private");

  return (
    <div>
      <span className="px-kicker" data-px-reveal>Choose your website system</span>
      <h2 data-px-reveal>Start with the system that matches how your business actually works.</h2>
      <p className="px-sub" data-px-reveal>
        NXQX-Business is available now. Upcoming systems stay visible so you can see what is next, while signup remains limited to client-ready experiences.
      </p>

      <div className="px-soon-bar" data-px-reveal role="note">
        <PhoneCall size={20} aria-hidden="true" />
        <strong>NXQX AI Receptionist</strong>
        <span className="px-soon-tag">Coming soon</span>
        <span>An AI assistant that answers your business calls, takes messages and booking requests, and sends you a summary of every call. Use it with an NXQX website or on its own.</span>
      </div>

      <div className="px-grid4">
        {visibleFamilies.map((family, index) => {
          const isSelectable = isPubliclySelectableFamily(family);
          const featured = family.slug === "business";

          if (!isSelectable) {
            return (
              <article
                aria-disabled="true"
                className={`px-card px-fam px-muted ${featured ? "px-live-fam" : ""}`}
                data-px-reveal
                key={family.slug}
              >
                <div className="px-fam-meta">
                  <span className="px-st">
                    {family.eyebrow} <Clock3 size={13} />
                  </span>
                </div>
                <h3>{family.name}</h3>
                <p>{family.description}</p>
                <p>{family.outcome}</p>
              </article>
            );
          }

          return (
            <a
              className={`px-card px-fam ${featured ? "px-live-fam" : ""}`}
              data-px-reveal
              data-px-spot
              href={`/portal/signup?family=${encodeURIComponent(family.slug)}`}
              key={family.slug}
            >
              <div className="px-fam-meta">
                <span className="px-st">
                  {family.eyebrow} {index === 0 ? <Sparkles size={13} /> : null}
                </span>
                <ArrowRight size={18} />
              </div>
              <h3>{family.name}</h3>
              <p>{family.description}</p>
              <p>{family.outcome}</p>
            </a>
          );
        })}

        {/* Standalone product, not one of the website systems: shown as coming soon only (no signup link, no prices). */}
        <article aria-disabled="true" className="px-card px-fam px-muted" data-px-reveal key="receptionist">
          <div className="px-fam-meta">
            <span className="px-st">
              Coming soon <Clock3 size={13} />
            </span>
          </div>
          <h3>NXQX-Receptionist</h3>
          <p>An AI assistant that answers your business calls, takes messages and booking requests, and sends you a summary of every call.</p>
          <p>Keep your own phone number. It is always open about being an AI assistant, and it works with or without an NXQX website.</p>
        </article>
      </div>
    </div>
  );
}
