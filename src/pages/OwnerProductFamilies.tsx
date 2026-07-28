import { ArrowLeft, Building2, CalendarDays, LockKeyhole, ShoppingBag, ShieldCheck } from "lucide-react";

const familyCards = [
  {
    name: "NXQ Business",
    description: "Managed websites, client projects, website security, and ongoing improvements.",
    status: "Available",
    icon: Building2,
    href: "/owner",
  },
  {
    name: "NXQ Commerce",
    description: "Storefront setup, catalogs, inventory, build reviews, and monthly usage controls.",
    status: "Active foundation",
    icon: ShoppingBag,
    href: "/owner/commerce",
  },
  {
    name: "NXQ Booking",
    description: "Appointments, availability, reminders, cancellations, and scheduling workflows.",
    status: "In development",
    icon: CalendarDays,
  },
  {
    name: "NXQ Security",
    description: "Future security-focused website services and protected client operations.",
    status: "In development",
    icon: ShieldCheck,
  },
];

export function OwnerProductFamilies() {
  return (
    <main className="nxq-page">
      <section className="portal-shell">
        <div className="panel-title panel-title-row">
          <div>
            <h1>Product families</h1>
            <p className="subtle">Keep each NXQ service branch organized in its own protected owner workspace.</p>
          </div>
          <a className="icon-btn" href="/owner"><ArrowLeft size={16} /> Back to owner</a>
        </div>

        <div className="panel panel-wide">
          <div className="panel-title">
            <LockKeyhole size={20} />
            <div>
              <h2>Owner-only family controls</h2>
              <p className="subtle">Client uploads stay inside their own workspace. Major build, payment, domain, and launch gates still require owner approval.</p>
            </div>
          </div>
        </div>

        <div className="portal-grid">
          {familyCards.map(({ name, description, status, icon: Icon, href }) => (
            <article className="panel" key={name}>
              <div className="panel-title">
                <Icon size={20} />
                <div>
                  <h2>{name}</h2>
                  <p className="subtle">{description}</p>
                </div>
              </div>
              <div className="status-summary">{status}</div>
              {href ? (
                <a className="wide-btn" href={href}>Open {name.replace("NXQ ", "")} workspace</a>
              ) : (
                <button className="wide-btn" disabled>Not available yet</button>
              )}
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
