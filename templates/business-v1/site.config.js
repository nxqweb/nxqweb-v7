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
    eyebrow: "Local business",
    headline: "Clear services. Simple next steps.",
    subheadline: "A local business website managed by NXQX-Web, with clear information and an easy way to get in touch.",
    primaryCta: "Request a Quote",
    secondaryCta: "View Services",
  },
  services: [
    { title: "Primary Service", description: "Describe the business's highest-priority service here." },
    { title: "Secondary Service", description: "Explain another important service and the customer outcome." },
    { title: "Additional Service", description: "Add another service or specialty offered by the business." },
  ],
  trust: {
    heading: "Clear information and simple next steps",
    points: ["Clear communication", "Straightforward service information", "Local support", "Simple next steps"],
  },
  about: {
    heading: "About the business",
    body: "Use the approved NXQX-Web intake and build plan to tell the business story, explain what makes it different, and give customers a clear reason to reach out.",
  },
  seo: {
    title: "Your Business | Local Services",
    description: "Local services with clear information and an easy way to get in touch.",
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
