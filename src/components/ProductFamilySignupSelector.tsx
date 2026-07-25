import { ArrowRight } from "lucide-react";
import { PRODUCT_FAMILIES } from "../lib/productCatalog";

export function ProductFamilySignupSelector() {
  return (
    <div className="lux-card" style={{ padding: "1.25rem", marginBottom: "1.5rem" }}>
      <div className="lux-section-head" style={{ marginBottom: "1rem" }}>
        <span>Choose your website system</span>
        <h3>Pick the NXQ product family your business needs.</h3>
        <p>After choosing a family, you will create your account and select Starter, Growth, Intelligence, or Enterprise.</p>
      </div>

      <div className="lux-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))" }}>
        {PRODUCT_FAMILIES.map((family) => (
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
        ))}
      </div>
    </div>
  );
}
