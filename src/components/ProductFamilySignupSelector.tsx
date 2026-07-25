import { ArrowRight, Clock3 } from "lucide-react";
import {
  isPubliclySelectableFamily,
  productFamilyCatalog as PRODUCT_FAMILIES,
} from "../lib/productCatalog";

export function ProductFamilySignupSelector() {
  return (
    <div className="lux-card" style={{ padding: "1.25rem", marginBottom: "1.5rem" }}>
      <div className="lux-section-head" style={{ marginBottom: "1rem" }}>
        <span>Choose your website system</span>
        <h3>Pick the NXQ product family your business needs.</h3>
        <p>
          Available families can be started now. Planned families stay visible while their complete workflows are being built and tested.
        </p>
      </div>

      <div className="lux-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))" }}>
        {PRODUCT_FAMILIES.filter((family) => family.status !== "private").map((family) => {
          const isSelectable = isPubliclySelectableFamily(family);

          if (!isSelectable) {
            return (
              <article
                aria-disabled="true"
                className="lux-card lux-service"
                key={family.slug}
                style={{ opacity: 0.72 }}
              >
                <h3>{family.name}</h3>
                <p>{family.description}</p>
                <span className="lux-plan-badge">
                  In development <Clock3 size={14} />
                </span>
              </article>
            );
          }

          return (
            <a
              className="lux-card lux-service"
              href={`/portal/signup?family=${encodeURIComponent(family.slug)}`}
              key={family.slug}
              style={{ textDecoration: "none" }}
            >
              <h3>{family.name}</h3>
              <p>{family.description}</p>
              <span className="lux-plan-badge">
                Choose family <ArrowRight size={14} />
              </span>
            </a>
          );
        })}
      </div>
    </div>
  );
}
