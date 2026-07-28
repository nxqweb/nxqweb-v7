import { ArrowLeft, Boxes, ClipboardCheck, Gauge, ShoppingBag, Store } from "lucide-react";

const commerceSections = [
  {
    label: "Client reviews",
    description: "Review submitted setup sheets, catalog readiness, blockers, and storefront build approval.",
    href: "/owner/commerce-reviews",
    icon: ClipboardCheck,
  },
  {
    label: "Build queue",
    description: "Freeze approved build snapshots behind explicit owner gates. Automation remains locked.",
    href: "/owner/commerce-builds",
    icon: Boxes,
  },
  {
    label: "Usage & limits",
    description: "See monthly new-product and image usage for every Commerce client.",
    href: "/owner/commerce-usage",
    icon: Gauge,
  },
  {
    label: "Stores",
    description: "A consolidated live-store operations area will be connected after the separate storefront pipeline.",
    icon: Store,
  },
];

export function OwnerCommerceHub() {
  return (
    <main className="nxq-page">
      <section className="portal-shell">
        <div className="panel-title panel-title-row">
          <div className="panel-title">
            <ShoppingBag size={22} />
            <div>
              <h1>NXQ Commerce</h1>
              <p className="subtle">Owner controls for storefront readiness, protected builds, and client usage.</p>
            </div>
          </div>
          <a className="icon-btn" href="/owner/product-families"><ArrowLeft size={16} /> Product families</a>
        </div>

        <div className="panel panel-wide">
          <h2>Commerce overview</h2>
          <p className="subtle">
            Clients can manage normal products, images, categories, and inventory without individual owner approvals.
            Owner approval remains required for setup review, migration, build readiness, payments, domains, and production launch.
          </p>
        </div>

        <div className="portal-grid">
          {commerceSections.map(({ label, description, href, icon: Icon }) => (
            <article className="panel" key={label}>
              <div className="panel-title">
                <Icon size={20} />
                <div>
                  <h2>{label}</h2>
                  <p className="subtle">{description}</p>
                </div>
              </div>
              {href ? <a className="wide-btn" href={href}>Open {label}</a> : <button className="wide-btn" disabled>Coming later</button>}
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
