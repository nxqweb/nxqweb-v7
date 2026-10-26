// The "Quick links" cards at the bottom of the client portal home and the Commerce pages. They exist so a client never has to know a web address: every page of the
// portal is one tap away. Plain data (no React) so a test can check every address against the real routes in App.tsx.
export type QuickLinkIcon =
  | "business" | "leads" | "changes" | "analytics" | "reports" | "funnel" | "seo" | "locations" | "health" | "domain" | "files" | "billing" | "journey" | "history"
  | "notifications" | "privacy" | "rewards" | "reviews" | "settings" | "assistant"
  | "dashboard" | "tutorial" | "products" | "photos" | "store" | "orders" | "setup" | "inventory" | "categories" | "catalog" | "preview" | "content" | "requests" | "usage" | "readiness";

export type QuickLinkItem = { href: string; label: string; hint: string; icon: QuickLinkIcon };

export const portalQuickLinks: QuickLinkItem[] = [
  { href: "/client/business", label: "Business workspace", hint: "Leads, changes, analytics and reports in one place", icon: "business" },
  { href: "/client/business/leads", label: "Leads", hint: "People who contacted your website", icon: "leads" },
  { href: "/client/business/changes", label: "Website changes", hint: "Ask for an update or a redesign", icon: "changes" },
  { href: "/client/business/analytics", label: "Analytics", hint: "Visits, clicks and scrolling", icon: "analytics" },
  { href: "/client/business/reports", label: "Reports", hint: "Your monthly report", icon: "reports" },
  { href: "/client/business/funnel", label: "Lead funnel", hint: "Where your leads come from", icon: "funnel" },
  { href: "/client/business/seo", label: "SEO", hint: "How you show up in search", icon: "seo" },
  { href: "/client/business/locations", label: "Locations", hint: "Your business locations", icon: "locations" },
  { href: "/client/health", label: "Website health", hint: "Uptime, SSL and security", icon: "health" },
  { href: "/client/domain", label: "Domain", hint: "Connect your own web address", icon: "domain" },
  { href: "/client/files", label: "Files", hint: "Logos, photos and documents", icon: "files" },
  { href: "/client/billing", label: "Billing", hint: "Your plan and payments", icon: "billing" },
  { href: "/client/journey", label: "Journey", hint: "Every step from setup to launch", icon: "journey" },
  { href: "/client/history", label: "What we did", hint: "A record of the work done for you", icon: "history" },
  { href: "/client/reviews", label: "Get reviews", hint: "A link and QR code for customer reviews", icon: "reviews" },
  { href: "/client/rewards", label: "Rewards", hint: "Refer a business and earn", icon: "rewards" },
  { href: "/client/notifications", label: "Notifications", hint: "Choose what you hear about", icon: "notifications" },
  { href: "/client/security-privacy", label: "Security and privacy", hint: "Your data and your rights", icon: "privacy" },
  { href: "/client/settings", label: "Settings", hint: "Your account and plan", icon: "settings" },
];

// Shown only when the "My assistant" switch (src/lib/siteAssistantConfig.ts) is on, so no client is sent to a page that says it is not switched on.
export const assistantQuickLink: QuickLinkItem = { href: "/client/assistant", label: "My assistant", hint: "Questions and answers your website can reply with", icon: "assistant" };

export const commerceQuickLinks: QuickLinkItem[] = [
  { href: "/client/commerce", label: "Dashboard", hint: "Your store at a glance", icon: "dashboard" },
  { href: "/client/commerce/tutorial", label: "Tutorial", hint: "Launch your store step by step", icon: "tutorial" },
  { href: "/client/commerce/products", label: "Products", hint: "Add and edit what you sell", icon: "products" },
  { href: "/client/commerce/images", label: "Photos", hint: "Add pictures to your products", icon: "photos" },
  { href: "/client/commerce/live", label: "Live store", hint: "Open your store and copy its link", icon: "store" },
  { href: "/client/commerce/orders", label: "Orders", hint: "See orders and confirm payments", icon: "orders" },
  { href: "/client/commerce/setup", label: "Setup", hint: "Tell us how your store works", icon: "setup" },
  { href: "/client/commerce/inventory", label: "Inventory", hint: "Stock levels", icon: "inventory" },
  { href: "/client/commerce/categories", label: "Categories", hint: "Group your products", icon: "categories" },
  { href: "/client/commerce/catalog", label: "Catalog", hint: "Your whole catalog", icon: "catalog" },
  { href: "/client/commerce/preview", label: "Preview", hint: "See your store like a customer", icon: "preview" },
  { href: "/client/commerce/content", label: "Website content", hint: "Words and pictures on your store site", icon: "content" },
  { href: "/client/commerce/requests", label: "Requests", hint: "Ask us for help", icon: "requests" },
  { href: "/client/commerce/usage", label: "Usage", hint: "What your plan includes", icon: "usage" },
  { href: "/client/commerce/readiness", label: "Readiness", hint: "What is left before you open", icon: "readiness" },
];

export type QuickLinkSet = { id: string; title: string; intro: string; links: QuickLinkItem[] };

// Which set (if any) belongs on a page. Only the portal home and the Commerce pages get one.
export function quickLinksForPath(pathname: string, options: { assistant?: boolean } = {}): QuickLinkSet | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (path === "/client") return { id: "portal", title: "Everything in your portal", intro: "Tap any card to go straight there.", links: options.assistant ? [...portalQuickLinks.slice(0, 15), assistantQuickLink, ...portalQuickLinks.slice(15)] : portalQuickLinks };
  if (path === "/client/commerce" || path.startsWith("/client/commerce/")) return { id: "commerce", title: "Everything in your store", intro: "Tap any card to go straight there.", links: commerceQuickLinks };
  return null;
}
