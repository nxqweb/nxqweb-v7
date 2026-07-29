import { Boxes, CircleHelp, ClipboardList, Eye, Gauge, Images, LayoutDashboard, MessageSquareText, PackagePlus, ShoppingBag, Tags } from "lucide-react";

const links = [
  { href: "/client/commerce", label: "Dashboard", icon: LayoutDashboard },
  { href: "/client/commerce/tutorial", label: "Tutorial", icon: CircleHelp },
  { href: "/client/commerce/products", label: "Products", icon: PackagePlus },
  { href: "/client/commerce/catalog", label: "Catalog", icon: Images },
  { href: "/client/commerce/preview", label: "Preview", icon: Eye },
  { href: "/client/commerce/categories", label: "Categories", icon: Tags },
  { href: "/client/commerce/inventory", label: "Inventory", icon: Boxes },
  { href: "/client/commerce/orders", label: "Orders", icon: ShoppingBag },
  { href: "/client/commerce/requests", label: "Requests", icon: MessageSquareText },
  { href: "/client/commerce/usage", label: "Usage", icon: Gauge },
  { href: "/client/commerce/setup", label: "Setup", icon: ClipboardList },
];

export function CommerceNav() {
  const path = window.location.pathname;

  return (
    <nav aria-label="Commerce workspace navigation" className="panel panel-wide" style={{ marginBottom: "1rem" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(108px, 1fr))",
          gap: "0.75rem",
          width: "100%",
        }}
      >
        {links.map(({ href, label, icon: Icon }) => (
          <a
            className={path === href ? "wide-btn" : "icon-btn"}
            href={href}
            key={href}
            style={{ justifyContent: "center", minWidth: 0, whiteSpace: "nowrap" }}
          >
            <Icon size={16} />
            {label}
          </a>
        ))}
      </div>
    </nav>
  );
}
