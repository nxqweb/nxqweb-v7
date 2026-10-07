export type FallbackRequest = {
  request_fingerprint: string;
  input: { business_name: string; business_type: string; service_area: string; desired_style: string };
  contract: { allowed_services: string[]; allowed_pages: string[]; allowed_theme_keys: string[] };
};

export const FALLBACK_SCHEMA_VERSION = "nxq-business-build-plan-v1";

// Used when no AI provider is configured (staging only). Its copy must stay free of every claim the grounding validator in
// _shared/ai-grounding.mjs rejects (trusted, reliable, professional, premium, fast, safe, quality, ...), or prepare-build-plan throws
// "unsupported marketing claims" and the build-plan job fails. scripts/test-build-plan-fallback.mjs enforces this.
export function stagingFallback(request: FallbackRequest) {
  const n = request.input.business_name;
  const t = request.input.business_type;
  const a = request.input.service_area;
  const services = request.contract.allowed_services;
  const pages = request.contract.allowed_pages;
  const style = request.input.desired_style.toLowerCase();
  const theme = style.includes("gold") ? "charcoal_gold"
    : style.includes("green") ? "forest_emerald"
    : style.includes("purple") || style.includes("violet") ? "royal_violet"
    : "midnight_blue";
  const clip = (value: string, max: number) => {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (normalized.length <= max) return normalized;
    const candidate = normalized.slice(0, max + 1);
    const boundary = candidate.lastIndexOf(" ");
    const clipped = boundary >= Math.floor(max * 0.7) ? candidate.slice(0, boundary) : normalized.slice(0, max);
    return clipped.replace(/[-,:;/]+$/g, "").trim();
  };
  const shortType = clip(t, 48) || "local service";
  const shortName = clip(n, 52) || "Local Business";
  const areaText = a ? ` across ${clip(a, 102)}` : " in the local service area";

  return {
    schema_version: FALLBACK_SCHEMA_VERSION,
    request_fingerprint: request.request_fingerprint,
    confidence: 0.9,
    risk_flags: [],
    strategy: {
      positioning: clip(`${shortName} is a ${shortType} business focused on clear service information, clear communication, and local enquiries.`, 300),
      audiences: ["Local customers", "Property owners and managers", "Businesses looking for service"],
      value_proposition: clip(`${shortName} presents its approved services with a clear path to request help, with a modern, easy-to-use customer experience.`, 320),
      voice: "Clear, confident, direct, and helpful without exaggerated claims.",
      hero: {
        eyebrow: clip(`${shortName} Local Service`, 80),
        headline: clip(`${shortName}: Clear Services, Simple Next Steps`, 110),
        subheadline: clip(`${shortName} makes it simple to understand available services, request a quote, and get in touch with the team.`, 260),
      },
      service_descriptions: services.map((service) => ({
        service,
        description: clip(`${shortName} provides ${service} with clear communication and an easy path for customers to request service.`, 280),
      })),
      trust_points: [
        "Clear customer communication",
        "Straightforward service planning",
        "Simple quote and contact pathways",
      ],
      about_summary: clip(`${shortName} serves customers looking for ${shortType} support${areaText}. The website explains services clearly and makes inquiries easy to route, without unsupported claims.`, 600),
      seo: {
        title: clip(`${shortName} Local Service`, 60),
        description: clip(`${shortName} provides ${shortType} services with clear information, simple contact options, and an easy quote request process.`, 160),
        keywords: [shortType, ...services.slice(0, 4), "local service"].map((value) => clip(value, 80)).slice(0, 10),
      },
      page_strategy: pages.map((page) => ({
        page,
        objective: clip(`Give the ${page} page a focused customer objective grounded only in the approved intake and guide visitors toward the right next step.`, 240),
        sections: ["Page introduction", "Primary page content", "Supporting trust content", "Contact call to action"],
      })),
      design: {
        theme_key: request.contract.allowed_theme_keys.includes(theme) ? theme : request.contract.allowed_theme_keys[0],
        mood: "Modern, polished, confident, high-contrast, and appropriate for a local-service business.",
        palette_guidance: ["Use a dark foundation", "Keep accent contrast strong and restrained", "Preserve excellent text readability"],
        typography_guidance: "Use large confident headings, readable body type, and a disciplined hierarchy that feels polished rather than flashy.",
        motion_guidance: "Use subtle purposeful transitions and restrained motion that supports clarity without distracting from calls to action.",
      },
    },
  };
}
