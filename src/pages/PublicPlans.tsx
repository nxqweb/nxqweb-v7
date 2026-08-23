import { ArrowRight, Building2, CalendarDays, CheckCircle2, MapPinned, MenuSquare, ShoppingBag, Store, UsersRound } from "lucide-react";

const plans = [
  {
    name: "NXQ-Business",
    status: "Available now",
    description: "Premium websites for service businesses, contractors, local companies, and growing brands.",
    icon: Building2,
    features: ["Premium custom website", "Client portal", "SEO setup", "Hosting and updates", "Monthly improvement support"],
    action: "Start with NXQ-Business",
    href: "/portal/signup",
    available: true,
  },
  {
    name: "NXQ-Booking",
    status: "Launching next",
    description: "Appointments, service scheduling, reminders, cancellations, and owner-controlled availability.",
    icon: CalendarDays,
    features: ["Service types", "Availability rules", "Booking confirmations", "Rescheduling", "Reminder workflows"],
  },
  {
    name: "NXQ-Commerce",
    status: "Planned",
    description: "Product catalogs, carts, checkout flows, order management, and customer accounts.",
    icon: ShoppingBag,
    features: ["Product catalog", "Cart and checkout", "Order tracking", "Customer accounts", "Store analytics"],
  },
  {
    name: "NXQ-Menu",
    status: "Planned",
    description: "Modern restaurant menus, ordering-ready layouts, specials, hours, and location details.",
    icon: MenuSquare,
    features: ["Digital menus", "Category management", "Specials", "Location hours", "Ordering integrations"],
  },
  {
    name: "NXQ-Property",
    status: "Planned",
    description: "Property listings, lead capture, agent profiles, inquiry routing, and searchable inventory.",
    icon: Store,
    features: ["Listings", "Search and filters", "Agent profiles", "Inquiry routing", "Property updates"],
  },
  {
    name: "NXQ-Multi-Location",
    status: "Planned",
    description: "One premium website with location-specific pages, content, contact details, and local SEO.",
    icon: MapPinned,
    features: ["Unified brand website", "Location pages", "Local SEO", "Location routing", "Central management"],
  },
  {
    name: "NXQ-Membership",
    status: "Planned",
    description: "Member accounts, gated content, subscriptions, communities, and recurring access rules.",
    icon: UsersRound,
    features: ["Member accounts", "Gated content", "Subscription access", "Member dashboard", "Renewal workflows"],
  },
  {
    name: "NXQ-Enterprise",
    status: "Future release",
    description: "Large-company websites, advanced permissions, multi-team workflows, integrations, and custom infrastructure.",
    icon: Building2,
    features: ["Advanced permissions", "Multi-team workflows", "Custom integrations", "Enterprise hosting", "Dedicated support"],
  },
];

export function PublicPlans() {
  return (
    <main className="nxq-page">
      <section className="portal-shell">
        <div className="portal-header">
          <div>
            <p className="eyebrow">NXQ-Web Plans</p>
            <h1>One website platform, built for different kinds of businesses</h1>
            <p className="subtle">
              NXQ-Business is available now. Additional plan families are being released in stages so each one launches with the same premium quality, automation, and owner-controlled safety.
            </p>
          </div>

          <a className="icon-btn" href="/">
            Back to NXQ-Web
          </a>
        </div>

        <div className="settings-grid">
          {plans.map((plan) => {
            const Icon = plan.icon;

            return (
              <article className="settings-card" key={plan.name}>
                <div className="panel-title">
                  <Icon size={20} />
                  <div>
                    <span>{plan.status}</span>
                    <strong>{plan.name}</strong>
                  </div>
                </div>

                <p>{plan.description}</p>

                <div>
                  {plan.features.map((feature) => (
                    <p key={feature}>
                      <CheckCircle2 size={15} /> {feature}
                    </p>
                  ))}
                </div>

                {plan.available ? (
                  <a className="wide-btn" href={plan.href}>
                    {plan.action} <ArrowRight size={16} />
                  </a>
                ) : (
                  <a
                    className="wide-btn"
                    href={`mailto:websitedesignercontact@protonmail.com?subject=${encodeURIComponent(`${plan.name} early access`)}`}
                  >
                    Join early access <ArrowRight size={16} />
                  </a>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}
