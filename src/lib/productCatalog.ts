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

export type ProductIntakeQuestion = {
  key: string;
  label: string;
  placeholder: string;
  required?: boolean;
  multiline?: boolean;
};

export type ProductFamilyDefinition = {
  slug: ProductFamilySlug;
  name: string;
  description: string;
  status: ProductFamilyStatus;
  eyebrow: string;
  outcome: string;
  intakeLabel: string;
  intakePlaceholder: string;
  intakeQuestions: ProductIntakeQuestion[];
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
    intakeQuestions: [
      {
        key: "services",
        label: "What services should the website sell?",
        placeholder: "Tree removal, trimming, stump grinding, emergency storm cleanup...",
        required: true,
        multiline: true,
      },
      {
        key: "best_customers",
        label: "Who are your best customers?",
        placeholder: "Homeowners, property managers, commercial properties, HOAs...",
        required: true,
      },
      {
        key: "conversion_action",
        label: "What should visitors do most often?",
        placeholder: "Call, request an estimate, submit a form, visit the shop...",
        required: true,
      },
      {
        key: "proof_assets",
        label: "What proof can we build around?",
        placeholder: "Reviews, project photos, certifications, warranties, years in business — only include facts you can verify.",
        multiline: true,
      },
    ],
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
    intakeQuestions: [
      {
        key: "bookable_services",
        label: "What can customers book?",
        placeholder: "Consultations, haircuts, estimates, lessons, service appointments...",
        required: true,
        multiline: true,
      },
      {
        key: "schedule_rules",
        label: "How should availability work?",
        placeholder: "Business hours, staff schedules, appointment lengths, buffers, blackout dates...",
        required: true,
        multiline: true,
      },
      {
        key: "booking_rules",
        label: "What booking rules matter?",
        placeholder: "Cancellation window, deposits, rescheduling, lead time, maximum advance booking...",
        required: true,
        multiline: true,
      },
      {
        key: "reminders",
        label: "What reminders or confirmations do you want?",
        placeholder: "Email confirmation, 24-hour reminder, same-day reminder...",
        multiline: true,
      },
    ],
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
    intakeQuestions: [
      {
        key: "catalog",
        label: "What do you sell?",
        placeholder: "Product types, approximate product count, variants, custom options...",
        required: true,
        multiline: true,
      },
      {
        key: "fulfillment",
        label: "How do customers receive orders?",
        placeholder: "Shipping, local delivery, pickup, digital delivery, made-to-order...",
        required: true,
      },
      {
        key: "inventory",
        label: "How should inventory behave?",
        placeholder: "Track quantities, unlimited stock, preorder, low-stock alerts...",
        required: true,
      },
      {
        key: "store_operations",
        label: "What does the team need after checkout?",
        placeholder: "Order statuses, fulfillment notes, customer accounts, returns, staff workflow...",
        multiline: true,
      },
    ],
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
    intakeQuestions: [
      {
        key: "menu_categories",
        label: "How is your menu organized?",
        placeholder: "Breakfast, lunch, dinner, drinks, desserts, services, packages...",
        required: true,
        multiline: true,
      },
      {
        key: "menu_details",
        label: "What details matter on each item?",
        placeholder: "Price, description, photo, dietary tags, spice level, availability...",
        required: true,
      },
      {
        key: "ordering_path",
        label: "How should customers order?",
        placeholder: "Call, third-party ordering link, pickup request, reservation, no ordering...",
        required: true,
      },
      {
        key: "specials_hours",
        label: "How often do specials, hours, or availability change?",
        placeholder: "Daily specials, seasonal menu, happy hour, holiday hours...",
        multiline: true,
      },
    ],
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
    intakeQuestions: [
      {
        key: "listing_types",
        label: "What types of properties or listings do you manage?",
        placeholder: "Homes, apartments, rentals, commercial, land, new construction...",
        required: true,
        multiline: true,
      },
      {
        key: "search_filters",
        label: "How should visitors search and filter?",
        placeholder: "Price, beds, baths, city, neighborhood, property type, availability...",
        required: true,
      },
      {
        key: "listing_source",
        label: "Where will listing data come from?",
        placeholder: "Manual entry, existing feed, spreadsheet, approved integration...",
        required: true,
      },
      {
        key: "inquiry_routing",
        label: "Who should receive listing inquiries?",
        placeholder: "Assigned agent, office, location team, shared inbox...",
        multiline: true,
      },
    ],
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
    intakeQuestions: [
      {
        key: "location_count",
        label: "How many locations do you operate?",
        placeholder: "3 now, growing to 6 this year...",
        required: true,
      },
      {
        key: "location_differences",
        label: "What changes by location?",
        placeholder: "Services, hours, pricing, staff, phone numbers, service areas...",
        required: true,
        multiline: true,
      },
      {
        key: "lead_routing",
        label: "How should leads route between locations?",
        placeholder: "ZIP code, city, selected location, service area, central team...",
        required: true,
      },
      {
        key: "local_seo",
        label: "What local markets matter most?",
        placeholder: "Priority cities, neighborhoods, service territories, expansion markets...",
        multiline: true,
      },
    ],
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
    intakeQuestions: [
      {
        key: "membership_levels",
        label: "What membership levels or access groups exist?",
        placeholder: "Basic, Pro, VIP, student, staff, alumni...",
        required: true,
        multiline: true,
      },
      {
        key: "member_access",
        label: "What should members get access to?",
        placeholder: "Content, downloads, dashboards, events, discounts, private pages...",
        required: true,
        multiline: true,
      },
      {
        key: "membership_lifecycle",
        label: "How should membership start, renew, pause, or end?",
        placeholder: "Monthly, annual, manual approval, grace period, cancellation rules...",
        required: true,
      },
      {
        key: "member_actions",
        label: "What should members be able to manage themselves?",
        placeholder: "Profile, plan, saved items, billing status, downloads, preferences...",
        multiline: true,
      },
    ],
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
    intakeQuestions: [
      {
        key: "organization_scope",
        label: "Describe the organization and website scope.",
        placeholder: "Departments, brands, regions, teams, public sites, internal surfaces...",
        required: true,
        multiline: true,
      },
      {
        key: "roles_permissions",
        label: "What roles and permission boundaries are needed?",
        placeholder: "Admins, editors, regional managers, support, read-only teams...",
        required: true,
        multiline: true,
      },
      {
        key: "integrations",
        label: "What systems may need approved integrations?",
        placeholder: "CRM, ERP, identity provider, analytics, support, internal APIs...",
        required: true,
        multiline: true,
      },
      {
        key: "compliance_operations",
        label: "What operational or compliance constraints matter?",
        placeholder: "Auditability, retention, approvals, data regions, accessibility, reporting...",
        multiline: true,
      },
    ],
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
