import { ArrowRight, Clock3, Sparkles } from "lucide-react";
import {
  isPubliclySelectableFamily,
  productFamilyCatalog as PRODUCT_FAMILIES,
} from "../lib/productCatalog";

export function ProductFamilySignupSelector() {
  const visibleFamilies = PRODUCT_FAMILIES.filter((family) => family.status !== "private");

  return (
    <div className="lux-card lux-family-shell">
      <div className="lux-section-head">
        <span>Choose your website system</span>
        <h2>Start with the system that matches how your business actually works.</h2>
        <p>
          NXQ-Business is available now. The other families stay visible so clients can see where the platform is going without accidentally entering an unfinished workflow.
        </p>
      </div>

      <div className="lux-family-grid">
        {visibleFamilies.map((family, index) => {
          const isSelectable = isPubliclySelectableFamily(family);
          const featured = family.slug === "business";

          if (!isSelectable) {
            return (
              <article
                aria-disabled="true"
                className={`lux-card lux-family-card muted ${featured ? "featured" : ""}`}
                key={family.slug}
              >
                <div className="lux-family-meta">
                  <span className="lux-plan-badge">
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
              className={`lux-card lux-family-card ${featured ? "featured" : ""}`}
              href={`/portal/signup?family=${encodeURIComponent(family.slug)}`}
              key={family.slug}
              aria-label={`Choose ${family.name}`}
            >
              <div className="lux-family-meta">
                <span className="lux-plan-badge">
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
      </div>
    </div>
  );
}
