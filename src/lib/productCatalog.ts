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

export type ProductFamilyDefinition = {
  slug: ProductFamilySlug;
  name: string;
  description: string;
  status: "available" | "beta" | "planned" | "private";
};

export type ProductTierDefinition = {
  key: ProductTierKey;
  name: string;
  priceLabel: string;
  description: string;
};

export const productFamilies: ProductFamilyDefinition[] = [
  {
    slug: "business",
    name: "NXQ Business",
    description: "Premium managed websites for service businesses, contractors, local companies, and growing brands.",
    status: "available",
  },
  {
    slug: "booking",
    name: "NXQ Booking",
    description: "Appointments, availability, reminders, cancellations, and scheduling workflows.",
    status: "planned",
  },
  {
    slug: "commerce",
    name: "NXQ Commerce",
    description: "Products, carts, checkout, orders, inventory, and customer accounts.",
    status: "planned",
  },
  {
    slug: "menu",
    name: "NXQ Menu",
    description: "Digital menus, specials, hours, locations, and ordering integrations.",
    status: "planned",
  },
  {
    slug: "property",
    name: "NXQ Property",
    description: "Searchable listings, agents, inquiries, and inventory management.",
    status: "planned",
  },
  {
    slug: "multi-location",
    name: "NXQ Multi-Location",
    description: "One premium website with location-specific pages, teams, contact details, and local SEO.",
    status: "planned",
  },
  {
    slug: "membership",
    name: "NXQ Membership",
    description: "Member accounts, subscriptions, gated content, dashboards, and renewals.",
    status: "planned",
  },
  {
    slug: "enterprise-systems",
    name: "NXQ Enterprise Systems",
    description: "Advanced permissions, integrations, departments, and custom infrastructure.",
    status: "private",
  },
];

export const productTiers: ProductTierDefinition[] = [
  {
    key: "starter",
    name: "Starter",
    priceLabel: "$50/mo",
    description: "The essential foundation for a smaller or simpler website system.",
  },
  {
    key: "growth",
    name: "Growth",
    priceLabel: "$100/mo",
    description: "More pages, stronger optimization, and deeper monthly improvements.",
  },
  {
    key: "intelligence",
    name: "Intelligence",
    priceLabel: "$150/mo",
    description: "Advanced insights, automation, and conversion-focused improvement planning.",
  },
  {
    key: "enterprise",
    name: "Enterprise",
    priceLabel: "Custom",
    description: "Custom workflows, integrations, scale, and advanced operational needs.",
  },
];

export function getProductFamily(slug: string | null) {
  return productFamilies.find((family) => family.slug === slug) || productFamilies[0];
}

export function getProductTier(key: string | null) {
  return productTiers.find((tier) => tier.key === key) || productTiers[0];
}
