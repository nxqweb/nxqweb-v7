export type BusinessIndustryPreset = {
  key: string;
  heroEyebrow: (serviceArea: string) => string;
  heroHeadline: (businessName: string) => string;
  heroSubheadline: string;
  primaryCta: string;
  secondaryCta: string;
  trustHeading: string;
  trustPoints: string[];
  aboutBody: (businessName: string, serviceArea: string) => string;
  serviceDescriptions: Record<string, string>;
  seoKeywords: string[];
};

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const treeServicesPreset: BusinessIndustryPreset = {
  key: "tree_services_v1",
  heroEyebrow: (serviceArea) => serviceArea ? `Tree care serving ${serviceArea}` : "Professional tree care",
  heroHeadline: (businessName) => `${businessName}. Safer properties. Clear next steps.`,
  heroSubheadline: "Tree removal, trimming, storm cleanup, and property care with a fast path to requesting an estimate.",
  primaryCta: "Request a Tree Service Estimate",
  secondaryCta: "Explore Tree Services",
  trustHeading: "A clearer path from tree concern to professional help",
  trustPoints: [
    "Easy estimate requests",
    "Mobile-first contact options",
    "Clear service-area guidance",
    "Urgent request routing",
  ],
  aboutBody: (businessName, serviceArea) => `${businessName} helps property owners understand their tree-service options${serviceArea ? ` across ${serviceArea}` : ""}. The website keeps services, coverage, and contact steps clear without inventing certifications, guarantees, or response times.`,
  serviceDescriptions: {
    "tree removal": "Removal options for unwanted, damaged, declining, or space-conflicting trees, with the final scope confirmed after the property is reviewed.",
    "tree trimming": "Tree trimming focused on clearance, shape, visibility, and property needs, with recommendations based on the specific tree and site.",
    "tree pruning": "Pruning options explained around tree condition, clearance, structure, and the goals confirmed during the estimate process.",
    "stump grinding": "Stump grinding options for reclaiming usable space and reducing above-ground stump obstructions after tree removal.",
    "emergency cleanup": "A direct request path for urgent storm debris and hazardous-tree concerns, without promising availability before the business confirms it.",
    "storm cleanup": "Storm-damage cleanup requests organized around the affected trees, access conditions, debris, and property priorities.",
    "hazardous tree assessment": "A request path for trees that appear damaged, unstable, leaning, or otherwise concerning, with no remote safety guarantee.",
    "lot clearing": "Tree, brush, and vegetation clearing inquiries organized around property size, access, intended use, and requested scope.",
    "brush removal": "Brush and overgrowth removal options for cleaner access, usable space, and property-maintenance needs.",
    "commercial maintenance": "Recurring or project-based tree-service inquiries for commercial properties, associations, facilities, and managed sites.",
  },
  seoKeywords: ["tree service", "tree removal", "tree trimming", "stump grinding", "storm cleanup"],
};

export function getBusinessIndustryPreset(businessType: string): BusinessIndustryPreset | null {
  const normalized = normalize(businessType);
  if (/\b(tree|arbor|forestry)\b/.test(normalized)) return treeServicesPreset;
  return null;
}

export function getPresetServiceDescription(preset: BusinessIndustryPreset | null, service: string) {
  if (!preset) return "";
  const normalizedService = normalize(service);
  const exact = preset.serviceDescriptions[normalizedService];
  if (exact) return exact;
  const partial = Object.entries(preset.serviceDescriptions).find(([key]) => normalizedService.includes(key) || key.includes(normalizedService));
  return partial?.[1] || "";
}
