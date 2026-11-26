// Fictional example business for NXQX-Web sales. It contains no real business identity, reviews, certifications, prices, guarantees or response times.
export const siteConfig = {
  schemaVersion: "nxq-business-v1",
  business: { name: "Northline Plumbing and Heating", type: "Plumbing and heating", phone: "", email: "", serviceArea: "Your Local Service Area" },
  brand: {
    eyebrow: "Plumbing requests, made straightforward",
    headline: "Say what is wrong. Get a clear next step.",
    subheadline: "A fictional plumbing and heating website that organizes services, service areas and urgent requests so a customer can reach out quickly.",
    primaryCta: "Request Plumbing Help",
    secondaryCta: "See Services",
  },
  services: [
    { title: "Leaks and Repairs", description: "A direct path to describe a leak or fixture problem, so the first message has the right details." },
    { title: "Drain Cleaning", description: "Requests for slow or blocked drains, with space for where the problem is." },
    { title: "Water Heaters", description: "Inquiries about repair and replacement, organized around the type of heater at the property." },
    { title: "Heating Systems", description: "A request path for heating problems and seasonal service questions." },
    { title: "New Installations", description: "Inquiries for new fixtures and upgrades, with room for the plan and timing." },
    { title: "Urgent Requests", description: "A clearly marked path for urgent problems, without inventing availability or response times." },
  ],
  trust: { heading: "A clearer path from problem to help", points: ["Easy request form", "Urgent requests highlighted", "Service area explained", "Phone-friendly contact"] },
  about: { heading: "Built for how customers search when something breaks", body: "This fictional demo shows how NXQX-Web can organize plumbing and heating services, service areas and urgent requests without inventing licenses, insurance, guarantees or response times. A real site would use the owner's own details." },
  seo: { title: "Northline Plumbing and Heating | Example site", description: "Fictional NXQX-Web example for a plumbing and heating.", keywords: ["plumber", "plumbing", "water heater", "drain cleaning", "heating"] },
  leads: { enabled: false, endpoint: "", formKey: "" },
  analytics: { enabled: false, endpoint: "", ingestKey: "", consentRequired: true, consentVersion: "v1", clicks: true, scrollDepth: true, mouseTracking: false },
  demo: { fictional: true, salesUseOnly: true, liveLeadCapture: false, liveAnalytics: false },
};
siteConfig.seo = { ...siteConfig.seo, enabled: false }; // fictional businesses: no structured data
siteConfig.design = { themeKey: "midnight_blue" };
