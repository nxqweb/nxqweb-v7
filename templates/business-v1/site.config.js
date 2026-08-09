export const siteConfig = {
  schemaVersion: "nxq-business-v1",
  business: {
    name: "Your Business",
    type: "Local service business",
    phone: "",
    email: "",
    serviceArea: "",
  },
  brand: {
    eyebrow: "Trusted local service",
    headline: "Professional service. Clear results.",
    subheadline: "A premium local business website managed by NXQ Web.",
    primaryCta: "Request a Quote",
    secondaryCta: "View Services",
  },
  services: [
    { title: "Primary Service", description: "Describe the business's highest-priority service here." },
    { title: "Secondary Service", description: "Explain another important service and the customer outcome." },
    { title: "Additional Service", description: "Add another service or specialty offered by the business." },
  ],
  trust: {
    heading: "Built around trust and reliable service",
    points: ["Clear communication", "Professional workmanship", "Local service", "Straightforward next steps"],
  },
  about: {
    heading: "A local team focused on doing the job right",
    body: "Use the approved NXQ intake and build plan to tell the business story, explain what makes it different, and give customers a clear reason to reach out.",
  },
  seo: {
    title: "Your Business | Local Professional Services",
    description: "Professional local services with clear communication and dependable support.",
  },
  leads: {
    enabled: false,
    endpoint: "",
    formKey: "",
  },
  analytics: {
    enabled: false,
    endpoint: "",
    ingestKey: "",
    consentRequired: true,
    consentVersion: "v1",
    clicks: true,
    scrollDepth: true,
    mouseTracking: false,
  },
};