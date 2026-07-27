import { Boxes, ClipboardList, LayoutDashboard, PackagePlus, Tags } from "lucide-react";

const links = [
  { href: "/client/commerce", label: "Dashboard", icon: LayoutDashboard },
  { href: "/client/commerce/products", label: "Products", icon: PackagePlus },
  { href: "/client/commerce/categories", label: "Categories", icon: Tags },
  { href: "/client/commerce/inventory", label: "Inventory", icon: Boxes },
  { href: "/client/commerce/setup", label: "Setup", icon: ClipboardList },
];

export function CommerceNav() {
  const path = window.location.pathname;

  return (
    <nav aria-label="Commerce workspace navigation" className="panel panel-wide" style={{ marginBottom: "1rem" }}>
      <div className="panel-title panel-title-row" style={{ gap: "0.75rem", flexWrap: "wrap" }}>
        {links.map(({ href, label, icon: Icon }) => (
          <a
            className={path === href ? "wide-btn" : "icon-btn"}
            href={href}
            key={href}
            style={{ flex: "1 1 150px", justifyContent: "center" }}
          >
            <Icon size={16} />
            {label}
          </a>
        ))}
      </div>
    </nav>
  );
}
