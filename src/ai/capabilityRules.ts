export type CapabilityDecision =
  | "approved_standard"
  | "approved_limited"
  | "owner_review_required"
  | "custom_quote_required"
  | "not_supported_yet";

export type CapabilityCategory =
  | "standard_website"
  | "lead_generation"
  | "booking"
  | "ecommerce"
  | "configurator"
  | "integration"
  | "restricted"
  | "unknown";

export type CapabilityRule = {
  featureName: string;
  category: CapabilityCategory;
  capabilityLevel: 1 | 2 | 3 | 4;
  keywords: string[];
  decision: CapabilityDecision;
  requiresOwnerApproval: boolean;
  requiresCustomQuote: boolean;
  requiresPaymentProvider: boolean;
  requiresExternalApi: boolean;
  riskLevel: "low" | "medium" | "high";
  clientSafeResponse: string;
  ownerInternalNote: string;
};

export type CapabilityClassification = {
  requestedText: string;
  decision: CapabilityDecision;
  highestLevel: 1 | 2 | 3 | 4;
  riskLevel: "low" | "medium" | "high";
  requiresOwnerApproval: boolean;
  requiresCustomQuote: boolean;
  requiresPaymentProvider: boolean;
  requiresExternalApi: boolean;
  matchedFeatures: string[];
  clientSafeSummary: string;
  ownerInternalSummary: string;
};

export const capabilityRules: CapabilityRule[] = [
  {
    featureName: "Standard business website",
    category: "standard_website",
    capabilityLevel: 1,
    keywords: ["home page", "about page", "services page", "contact form", "gallery", "testimonials", "faq", "seo", "business website"],
    decision: "approved_standard",
    requiresOwnerApproval: false,
    requiresCustomQuote: false,
    requiresPaymentProvider: false,
    requiresExternalApi: false,
    riskLevel: "low",
    clientSafeResponse: "NXQ can support this as part of a standard website build when it fits the selected package.",
    ownerInternalNote: "Safe standard website feature. Include in the normal build plan unless package scope is too small.",
  },
  {
    featureName: "Lead capture or quote request flow",
    category: "lead_generation",
    capabilityLevel: 1,
    keywords: ["lead form", "quote request", "estimate request", "request a quote", "get a quote", "contact form", "contact request", "service request"],
    decision: "approved_standard",
    requiresOwnerApproval: false,
    requiresCustomQuote: false,
    requiresPaymentProvider: false,
    requiresExternalApi: false,
    riskLevel: "low",
    clientSafeResponse: "This is a standard website feature. The website can include contact, lead, or quote request sections when they fit the selected package.",
    ownerInternalNote: "Standard launch-safe website feature. Include normal contact/quote request flow in the build plan without creating an extra capability approval.",
  },
  {
    featureName: "Basic booking or appointment request",
    category: "booking",
    capabilityLevel: 1,
    keywords: ["booking request", "appointment request", "schedule request", "request appointment", "book a consultation"],
    decision: "approved_standard",
    requiresOwnerApproval: false,
    requiresCustomQuote: false,
    requiresPaymentProvider: false,
    requiresExternalApi: false,
    riskLevel: "low",
    clientSafeResponse: "The website can include a basic booking or appointment request form. It should not promise confirmed appointments automatically.",
    ownerInternalNote: "Safe as a request/intake form. Do not treat as advanced unless it needs live calendar sync, automatic confirmations, payments, or external integrations.",
  },
  {
    featureName: "Basic product or service catalog",
    category: "standard_website",
    capabilityLevel: 1,
    keywords: ["product catalog", "service catalog", "services offered", "products and services", "service list", "product list"],
    decision: "approved_standard",
    requiresOwnerApproval: false,
    requiresCustomQuote: false,
    requiresPaymentProvider: false,
    requiresExternalApi: false,
    riskLevel: "low",
    clientSafeResponse: "The website can include a basic product or service catalog. Checkout, payments, inventory sync, or custom ordering still require separate review.",
    ownerInternalNote: "Safe standard website content. Only route advanced review when checkout, payments, inventory sync, or custom app behavior is requested.",
  },
  {
    featureName: "Full ecommerce checkout",
    category: "ecommerce",
    capabilityLevel: 3,
    keywords: ["checkout", "cart", "stripe", "paypal", "online payment", "pay online", "shipping", "taxes", "discount code", "coupon"],
    decision: "owner_review_required",
    requiresOwnerApproval: true,
    requiresCustomQuote: true,
    requiresPaymentProvider: true,
    requiresExternalApi: true,
    riskLevel: "high",
    clientSafeResponse: "Full checkout may be possible, but NXQ needs owner review before confirming payment, shipping, tax, and provider requirements.",
    ownerInternalNote: "Do not promise checkout automatically. Requires provider readiness, legal/tax/shipping decisions, and likely custom quote.",
  },
  {
    featureName: "Preset vehicle build request system",
    category: "configurator",
    capabilityLevel: 3,
    keywords: ["car customizer", "customize cars", "vehicle customizer", "build a car", "choose wheels", "choose paint", "mods", "trim", "tint", "dealership", "dealer"],
    decision: "custom_quote_required",
    requiresOwnerApproval: true,
    requiresCustomQuote: true,
    requiresPaymentProvider: false,
    requiresExternalApi: false,
    riskLevel: "high",
    clientSafeResponse: "NXQ can plan a limited preset-option vehicle build request system. Advanced visual or 3D customization requires owner review and custom scope.",
    ownerInternalNote: "Offer safe version first: preset options, photos, quote request, dealer follow-up. Do not promise real-time 3D or inventory sync.",
  },
  {
    featureName: "Advanced visual or 3D configurator",
    category: "configurator",
    capabilityLevel: 4,
    keywords: ["3d customizer", "3d configurator", "live visualizer", "real time visualizer", "render", "ar preview", "virtual preview", "parts compatibility"],
    decision: "not_supported_yet",
    requiresOwnerApproval: true,
    requiresCustomQuote: true,
    requiresPaymentProvider: false,
    requiresExternalApi: true,
    riskLevel: "high",
    clientSafeResponse: "This is an advanced custom application and cannot be confirmed automatically. NXQ needs owner review before promising scope, timeline, or pricing.",
    ownerInternalNote: "Treat as advanced custom app. Likely requires assets, data source, external APIs, 3D/image system, and large scope.",
  },
  {
    featureName: "Inventory or external system sync",
    category: "integration",
    capabilityLevel: 4,
    keywords: ["inventory sync", "live inventory", "crm sync", "api integration", "manufacturer data", "dealer inventory", "sync products", "sync cars"],
    decision: "custom_quote_required",
    requiresOwnerApproval: true,
    requiresCustomQuote: true,
    requiresPaymentProvider: false,
    requiresExternalApi: true,
    riskLevel: "high",
    clientSafeResponse: "Live syncing with external systems requires owner review, API access, and custom scoping before NXQ can confirm it.",
    ownerInternalNote: "Do not promise external integrations without API access, credentials, pricing, and maintenance plan.",
  },
  {
    featureName: "Restricted legal, medical, financial, or government workflow",
    category: "restricted",
    capabilityLevel: 4,
    keywords: ["loan application", "financing application", "insurance quote", "medical portal", "legal contract", "background check", "bank account", "government records", "patient", "social security"],
    decision: "not_supported_yet",
    requiresOwnerApproval: true,
    requiresCustomQuote: true,
    requiresPaymentProvider: false,
    requiresExternalApi: true,
    riskLevel: "high",
    clientSafeResponse: "This request involves restricted or high-risk workflows and cannot be confirmed automatically. NXQ owner review is required.",
    ownerInternalNote: "High-risk. Do not allow AI to promise this. Requires compliance review and likely should be declined or deferred.",
  },
];

const decisionRank: Record<CapabilityDecision, number> = {
  approved_standard: 1,
  approved_limited: 2,
  owner_review_required: 3,
  custom_quote_required: 4,
  not_supported_yet: 5,
};

const riskRank: Record<"low" | "medium" | "high", number> = {
  low: 1,
  medium: 2,
  high: 3,
};

function normalizeText(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

export function classifyCapabilityRequest(requestedText: string): CapabilityClassification {
  const normalizedRequest = normalizeText(requestedText);

  const matches = capabilityRules.filter((rule) =>
    rule.keywords.some((keyword) => normalizedRequest.includes(normalizeText(keyword)))
  );

  if (matches.length === 0) {
    return {
      requestedText,
      decision: "owner_review_required",
      highestLevel: 3,
      riskLevel: "medium",
      requiresOwnerApproval: true,
      requiresCustomQuote: false,
      requiresPaymentProvider: false,
      requiresExternalApi: false,
      matchedFeatures: [],
      clientSafeSummary: "NXQ needs owner review before confirming this feature because it does not match a standard launch capability yet.",
      ownerInternalSummary: "Unknown feature request. Owner should classify scope before the AI promises anything.",
    };
  }

  const decision = matches.reduce<CapabilityDecision>((highest, rule) => {
    return decisionRank[rule.decision] > decisionRank[highest] ? rule.decision : highest;
  }, "approved_standard");

  const riskLevel = matches.reduce<"low" | "medium" | "high">((highest, rule) => {
    return riskRank[rule.riskLevel] > riskRank[highest] ? rule.riskLevel : highest;
  }, "low");

  const highestLevel = matches.reduce<1 | 2 | 3 | 4>((highest, rule) => {
    return rule.capabilityLevel > highest ? rule.capabilityLevel : highest;
  }, 1);

  const requiresOwnerApproval = matches.some((rule) => rule.requiresOwnerApproval);
  const requiresCustomQuote = matches.some((rule) => rule.requiresCustomQuote);
  const requiresPaymentProvider = matches.some((rule) => rule.requiresPaymentProvider);
  const requiresExternalApi = matches.some((rule) => rule.requiresExternalApi);
  const matchedFeatures = matches.map((rule) => rule.featureName);
  const finalRule = matches[matches.length - 1];

  return {
    requestedText,
    decision,
    highestLevel,
    riskLevel,
    requiresOwnerApproval,
    requiresCustomQuote,
    requiresPaymentProvider,
    requiresExternalApi,
    matchedFeatures,
    clientSafeSummary: finalRule.clientSafeResponse,
    ownerInternalSummary: `Matched capability rules: ${matchedFeatures.join(", ")}. Highest level: ${highestLevel}. Decision: ${decision}. Owner approval: ${requiresOwnerApproval ? "yes" : "no"}. Custom quote: ${requiresCustomQuote ? "yes" : "no"}.`,
  };
}
