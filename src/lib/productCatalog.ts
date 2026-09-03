export type ProductFamilySlug =
  | "business"
  | "booking"
  | "commerce"
  | "menu"
  | "property"
  | "multi-location"
  | "membership"
  | "enterprise-systems";

export type ProductTierKey = "starter" | "growth" | "intelligence" | "enterprise";

export type ProductFamilyStatus = "available" | "beta" | "planned" | "private";

export type ProductFamilyDefinition = {
  slug: ProductFamilySlug;
  name: string;
  description: string;
  status: ProductFamilyStatus;
  eyebrow: string;
  outcome: string;
  intakeLabel: string;
  intakePlaceholder: string;
};

export type ProductTierDefinition = {
  key: ProductTierKey;
  name: string;
  priceLabel: string;
  description: string;
  badge: string;
  outcome: string;
  features: string[];
};

export const productFamilyCatalog: ProductFamilyDefinition[] = [
  {
    slug: "business",
    name: "NXQ-Business",
    description: "Premium managed websites for service businesses, contractors, local companies, and growing brands.",
    status: "available",
    eyebrow: "Available now",
    outcome: "Look premium, get found, capture leads, and keep improving without babysitting your website.",
    intakeLabel: "Services and service area",
    intakePlaceholder: "Tell us what you sell, where you work, and the kinds of customers you want more of.",
  },
  {
    slug: "booking",
    name: "NXQ-Booking",
    description: "Appointments, availability, reminders, cancellations, and scheduling workflows.",
    status: "planned",
    eyebrow: "Launching next",
    outcome: "Turn your website into a clean scheduling system that reduces back-and-forth.",
    intakeLabel: "Booking workflow",
    intakePlaceholder: "Services, appointment lengths, team availability, cancellation rules, and reminder needs.",
  },
  {
    slug: "commerce",
    name: "NXQ-Commerce",
    description: "Products, carts, checkout, orders, inventory, and customer accounts.",
    status: "planned",
    eyebrow: "In development",
    outcome: "Sell online with a storefront that stays organized from product setup through fulfillment.",
    intakeLabel: "Catalog and fulfillment",
    intakePlaceholder: "Products, inventory, shipping or pickup, checkout needs, and how orders should be managed.",
  },
  {
    slug: "menu",
    name: "NXQ-Menu",
    description: "Digital menus, specials, hours, locations, and ordering integrations.",
    status: "planned",
    eyebrow: "In development",
    outcome: "Make menus fast to browse, easy to update, and ready for ordering integrations.",
    intakeLabel: "Menu structure",
    intakePlaceholder: "Menu categories, specials, hours, locations, dietary notes, and ordering links.",
  },
  {
    slug: "property",
    name: "NXQ-Property",
    description: "Searchable listings, agents, inquiries, and inventory management.",
    status: "planned",
    eyebrow: "In development",
    outcome: "Present inventory beautifully while routing serious inquiries to the right person.",
    intakeLabel: "Listings and inquiry flow",
    intakePlaceholder: "Property types, listing fields, agents, search filters, and how inquiries should be routed.",
  },
  {
    slug: "multi-location",
    name: "NXQ-Multi-Location",
    description: "One premium website with location-specific pages, teams, contact details, and local SEO.",
    status: "planned",
    eyebrow: "Specialized system",
    outcome: "Operate one brand while every location gets its own high-quality local presence.",
    intakeLabel: "Locations and routing",
    intakePlaceholder: "Locations, teams, service differences, contact details, and local SEO priorities.",
  },
  {
    slug: "membership",
    name: "NXQ-Membership",
    description: "Member accounts, subscriptions, gated content, dashboards, and renewals.",
    status: "planned",
    eyebrow: "Specialized system",
    outcome: "Give customers a secure member experience with recurring access and gated content.",
    intakeLabel: "Membership experience",
    intakePlaceholder: "Membership levels, gated content, billing cadence, member benefits, and renewal rules.",
  },
  {
    slug: "enterprise-systems",
    name: "NXQ-Enterprise Systems",
    description: "Advanced permissions, integrations, departments, and custom infrastructure.",
    status: "private",
    eyebrow: "Custom",
    outcome: "Custom website infrastructure for organizations with deeper operational requirements.",
    intakeLabel: "Enterprise requirements",
    intakePlaceholder: "Teams, permissions, locations, integrations, reporting, and infrastructure needs.",
  },
];

export const productTiers: ProductTierDefinition[] = [
  {
    key: "starter",
    name: "Starter",
    priceLabel: "$50/mo",
    description: "A polished professional website with the essentials handled for you.",
    badge: "Best entry",
    outcome: "Professional presence",
    features: [
      "Premium 1–3 page website",
      "Mobile-first responsive design",
      "Hosting, SSL, and baseline maintenance",
      "Basic SEO foundation",
      "Lead/contact form",
      "Client portal and update requests",
    ],
  },
  {
    key: "growth",
    name: "Growth",
    priceLabel: "$100/mo",
    description: "A stronger website system built to improve visibility and generate more qualified leads.",
    badge: "Most popular",
    outcome: "Get found + get leads",
    features: [
      "Everything in Starter",
      "Up to 5 core pages",
      "Service-area and local SEO structure",
      "Lead tracking and stronger calls to action",
      "Monthly website/content improvements",
      "SEO and content opportunity guidance",
    ],
  },
  {
    key: "intelligence",
    name: "Intelligence",
    priceLabel: "$150/mo",
    description: "A continuously reviewed website system focused on conversion, performance, and ongoing improvement.",
    badge: "Most advanced",
    outcome: "Analyze + optimize",
    features: [
      "Everything in Growth",
      "Click and scroll behavior insights",
      "Conversion and page-interaction review",
      "Monthly performance and optimization cycle",
      "Lead-source and funnel insights",
      "Priority improvement recommendations",
    ],
  },
  {
    key: "enterprise",
    name: "Enterprise",
    priceLabel: "$150+/mo",
    description: "Custom systems for multi-location companies, larger teams, and advanced operational requirements.",
    badge: "Custom",
    outcome: "Custom scale",
    features: [
      "Custom page and location scope",
      "Advanced reporting and workflows",
      "Multi-location and team requirements",
      "Custom routing and permissions",
      "Higher usage and support needs",
      "Custom integrations when approved",
    ],
  },
];

export function isPubliclySelectableFamily(family: ProductFamilyDefinition) {
  return family.status === "available" || family.status === "beta";
}

export const publiclySelectableProductFamilies = productFamilyCatalog.filter(isPubliclySelectableFamily);

// Existing clients may request Commerce through the guarded owner-review flow while
// Commerce remains publicly marked as planned and unavailable for direct signup.
export const planChangeProductFamilies = productFamilyCatalog.filter(
  (family) => isPubliclySelectableFamily(family) || family.slug === "commerce"
);

// Kept as the plan-management list for compatibility with ClientPlanManagement.
export const productFamilies = planChangeProductFamilies;

export function getProductFamily(slug: string | null) {
  const requested = productFamilyCatalog.find((family) => family.slug === slug);
  return requested && isPubliclySelectableFamily(requested)
    ? requested
    : publiclySelectableProductFamilies[0] || productFamilyCatalog[0];
}

export function getRequestedProductFamily(slug: string | null) {
  return productFamilyCatalog.find((family) => family.slug === slug) || null;
}

export function getProductTier(key: string | null) {
  return productTiers.find((tier) => tier.key === key) || productTiers[0];
}
