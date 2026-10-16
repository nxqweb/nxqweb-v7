import { useEffect, useRef, useState } from "react";
import { Boxes, CircleHelp, ClipboardCheck, ClipboardList, Eye, FileText, Gauge, Images, LayoutDashboard, MessageSquareText, PackagePlus, ShoppingBag, Store, Tags } from "lucide-react";

// Everyday pages first (they are what fits on a phone screen), advanced pages after. On a computer the advanced pages sit behind a
// "More pages" button; on a phone the whole menu is one swipeable row.
const everydayCount = 7;
const links = [
  { href: "/client/commerce", label: "Dashboard", icon: LayoutDashboard },
  { href: "/client/commerce/tutorial", label: "Tutorial", icon: CircleHelp },
  { href: "/client/commerce/products", label: "Products", icon: PackagePlus },
  { href: "/client/commerce/images", label: "Photos", icon: Images },
  { href: "/client/commerce/live", label: "Live store", icon: Store },
  { href: "/client/commerce/orders", label: "Orders", icon: ShoppingBag },
  { href: "/client/commerce/setup", label: "Setup", icon: ClipboardList },
  { href: "/client/commerce/inventory", label: "Inventory", icon: Boxes },
  { href: "/client/commerce/categories", label: "Categories", icon: Tags },
  { href: "/client/commerce/catalog", label: "Catalog", icon: Images },
  { href: "/client/commerce/preview", label: "Preview", icon: Eye },
  { href: "/client/commerce/content", label: "Website content", icon: FileText },
  { href: "/client/commerce/requests", label: "Requests", icon: MessageSquareText },
  { href: "/client/commerce/usage", label: "Usage", icon: Gauge },
  { href: "/client/commerce/readiness", label: "Readiness", icon: ClipboardCheck },
];

export function CommerceNav() {
  const path = window.location.pathname;
  const navRef = useRef<HTMLElement | null>(null);
  const onAdvancedPage = links.slice(everydayCount).some((link) => link.href === path);
  const [showMore, setShowMore] = useState(onAdvancedPage);

  // On a phone the menu is one scrollable row, so bring the current page's button into view.
  useEffect(() => {
    try { navRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "center" }); } catch { /* cosmetic only */ }
  }, []);

  return (
    <nav aria-label="Commerce workspace navigation" className="panel panel-wide commerce-nav" ref={navRef}>
      <div className="commerce-nav-grid">
        {links.map(({ href, label, icon: Icon }, index) => (
          <a
            aria-current={path === href ? "page" : undefined}
            className={`commerce-nav-link ${path === href ? "wide-btn" : "icon-btn"}${index >= everydayCount ? " commerce-nav-more" : ""}${showMore ? " is-shown" : ""}`}
            href={href}
            key={href}
          >
            <Icon size={16} style={{ flexShrink: 0 }} />
            <span>{label}</span>
          </a>
        ))}
        <button aria-expanded={showMore} className="commerce-nav-toggle icon-btn" type="button" onClick={() => setShowMore((open) => !open)}>
          {showMore ? "Fewer pages" : "More pages"}
        </button>
      </div>
    </nav>
  );
}
