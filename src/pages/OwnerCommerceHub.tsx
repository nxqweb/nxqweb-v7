import { ArrowLeft, Boxes, Gauge, ServerCog, ShoppingBag, Store, Users } from "lucide-react";

const commerceSections = [
  {
    label: "Commerce clients",
    description: "See each Commerce client's plan, setup status, usage, and major storefront requests without opening their routine store data.",
    href: "/owner/commerce-reviews",
    icon: Users,
  },
  {
    label: "Automatic provisioning",
    description: "Track automatic GitHub repository creation, Netlify previews, failures, retries, and protected final launch approval.",
    href: "/owner/storefront-provisioning",
    icon: ServerCog,
  },
  {
    label: "Build & launch requests",
    description: "Review explicit storefront creation, migration, preview, domain, payment, and production-launch requests.",
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
    label: "Live stores",
    description: "A consolidated store-health and operations area will be connected after the separate storefront pipeline.",
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
              <p className="subtle">Owner controls for plans, limits, major storefront requests, and protected launches.</p>
            </div>
          </div>
          <a className="icon-btn" href="/owner/product-families"><ArrowLeft size={16} /> Product families</a>
        </div>

        <div className="panel panel-wide">
          <h2>Client-owned store data</h2>
          <p className="subtle">
            Clients manage their own products, images, categories, prices, inventory, and normal edits. NXQ enforces plan limits automatically and does not require routine owner approval.
          </p>
          <p className="subtle">
            Owner approval is reserved for major actions: creating or migrating a storefront, connecting payments or domains, and publishing to production.
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
