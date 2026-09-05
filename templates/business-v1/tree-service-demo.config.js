// Fictional, nationwide-safe flagship demo configuration for NXQ-Web sales.
// It contains no real business identity, reviews, certifications, prices, or guarantees.
export const siteConfig = {
  schemaVersion: "nxq-business-v1",
  business: {
    name: "Canopy Ridge Tree Care",
    type: "Tree service",
    phone: "",
    email: "",
    serviceArea: "Your Local Service Area",
  },
  brand: {
    eyebrow: "Professional tree care for local properties",
    headline: "Safer properties. Clear next steps.",
    subheadline: "A premium tree-service website demo built to make estimates, urgent requests, service coverage, and mobile contact paths easy to understand.",
    primaryCta: "Request a Tree Service Estimate",
    secondaryCta: "Explore Tree Services",
  },
  services: [
    { title: "Tree Removal", description: "Clear removal-request details for unwanted, damaged, declining, or space-conflicting trees." },
    { title: "Tree Trimming", description: "A direct path to ask about clearance, shape, visibility, and property-specific trimming needs." },
    { title: "Stump Grinding", description: "Stump-grinding requests organized around access, location, and the space the customer wants to reclaim." },
    { title: "Storm Cleanup", description: "Urgent storm-damage requests routed without inventing availability or response-time guarantees." },
    { title: "Hazardous Tree Concerns", description: "A careful request path for leaning, damaged, unstable, or otherwise concerning trees." },
    { title: "Commercial Maintenance", description: "Tree-service inquiries for commercial properties, facilities, associations, and managed sites." },
  ],
  trust: {
    heading: "A clearer path from tree concern to professional help",
    points: ["Easy estimate requests", "Mobile-first contact options", "Clear service-area guidance", "Urgent request routing"],
  },
  about: {
    heading: "Built for the way tree-service customers actually search",
    body: "This fictional demo shows how NXQ-Web can organize tree services, service areas, urgent requests, trust information, and contact paths without inventing credentials, reviews, guarantees, or business history.",
  },
  seo: {
    title: "Canopy Ridge Tree Care | Tree Service Demo",
    description: "Fictional NXQ-Web tree-service demo for removal, trimming, stump grinding, storm cleanup, and estimate requests.",
    keywords: ["tree service", "tree removal", "tree trimming", "stump grinding", "storm cleanup"],
  },
  leads: { enabled: false, endpoint: "", formKey: "" },
  analytics: { enabled: false, endpoint: "", ingestKey: "", consentRequired: true, consentVersion: "v1", clicks: true, scrollDepth: true, mouseTracking: false },
  demo: { fictional: true, salesUseOnly: true, liveLeadCapture: false, liveAnalytics: false },
};
