import {
  Activity, Bot, BarChart3, Bell, Boxes, Building2, CircleHelp, ClipboardCheck, ClipboardList, CreditCard, Eye, FileClock, FileText, Filter, Folder, Gauge, Gift, Globe, History, Images,
  LayoutDashboard, MapPin, MessageSquareText, PackagePlus, Route, Search, Settings, ShieldCheck, ShoppingBag, Star, Store, Tags, Target,
} from "lucide-react";
import type { ComponentType } from "react";
import { quickLinksForPath, type QuickLinkIcon } from "../lib/quickLinks";
import { siteAssistantGateway } from "../lib/siteAssistantConfig";
import { screenAttentionGateway } from "../lib/screenAttentionMapConfig";

const icons: Record<QuickLinkIcon, ComponentType<{ size?: number; "aria-hidden"?: boolean; style?: React.CSSProperties }>> = {
  business: Building2, leads: Target, changes: MessageSquareText, analytics: BarChart3, reports: FileClock, funnel: Filter, seo: Search, locations: MapPin, health: Activity, domain: Globe,
  files: Folder, billing: CreditCard, journey: Route, history: History, notifications: Bell, privacy: ShieldCheck, rewards: Gift, reviews: Star, settings: Settings,
  dashboard: LayoutDashboard, tutorial: CircleHelp, products: PackagePlus, photos: Images, store: Store, orders: ShoppingBag, setup: ClipboardList, inventory: Boxes, categories: Tags,
  catalog: Images, preview: Eye, content: FileText, requests: MessageSquareText, usage: Gauge, readiness: ClipboardCheck, assistant: Bot, attention: BarChart3,
};

// Rendered once by App for the portal home and every Commerce page, below the page itself. It has its own wrapper (not `.nxq-page`, which is a full-screen-tall box) so it adds
// cards, not another empty screen.
export function QuickLinksFooter() {
  const path = window.location.pathname;
  const set = quickLinksForPath(path, { assistant: Boolean(siteAssistantGateway), attention: Boolean(screenAttentionGateway) });
  if (!set) return null;
  const here = path.length > 1 ? path.replace(/\/+$/, "") : path;
  return (
    <div className="quick-links-footer">
      <div className="portal-shell">
        <nav aria-labelledby={`quick-links-${set.id}`} className="panel panel-wide quick-links" data-testid={`quick-links-${set.id}`}>
          <h2 id={`quick-links-${set.id}`}>{set.title}</h2>
          <p className="subtle">{set.intro}</p>
          <div className="quick-links-grid">
            {set.links.map(({ href, label, hint, icon }) => {
              const Icon = icons[icon];
              return (
                <a aria-current={here === href ? "page" : undefined} className="icon-btn quick-link" href={href} key={href}>
                  <Icon aria-hidden size={20} style={{ flexShrink: 0 }} />
                  <span><strong>{label}</strong><small>{hint}</small></span>
                </a>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}
