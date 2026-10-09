import { ArrowRight, Clock3, Sparkles } from "lucide-react";
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
              aria-label={`Choose ${family.name}`}
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
      </div>
    </div>
  );
}
