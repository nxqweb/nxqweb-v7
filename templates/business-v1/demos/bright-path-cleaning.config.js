// Fictional example business for NXQX-Web sales. It contains no real business identity, reviews, certifications, prices, guarantees or response times.
export const siteConfig = {
  schemaVersion: "nxq-business-v1",
  business: { name: "Bright Path Cleaning Co.", type: "Cleaning service", phone: "", email: "", serviceArea: "Your Local Service Area" },
  brand: {
    eyebrow: "Cleaning requests, made simple",
    headline: "A clear way to ask for a clean.",
    subheadline: "A fictional cleaning-service website that explains the services and makes it easy to request a quote.",
    primaryCta: "Request a Cleaning Quote",
    secondaryCta: "See Services",
  },
  services: [
    { title: "Home Cleaning", description: "A request path for regular and one-time home cleaning, organized around the size and needs of the home." },
    { title: "Deep Cleaning", description: "A clear place to describe what needs extra attention, so the quote starts from the right details." },
    { title: "Move-In and Move-Out", description: "Requests for empty homes and apartments, with space for dates and notes." },
    { title: "Office Cleaning", description: "Inquiries from small offices and shops, with room for schedule and access notes." },
    { title: "Recurring Plans", description: "A simple way to ask about a regular schedule instead of a single visit." },
    { title: "Special Requests", description: "Space for anything unusual, so the customer is never guessing whether to ask." },
  ],
  trust: { heading: "From messy to a clear next step", points: ["Easy quote requests", "Service area explained", "Works well on a phone", "Notes for special requests"] },
  about: { heading: "Built for how customers ask for a cleaner", body: "This fictional demo shows how NXQX-Web can organize cleaning services, service areas and quote requests without inventing reviews, certifications, prices or guarantees. A real site would use the owner's own services and details." },
  seo: { title: "Bright Path Cleaning Co. | Example site", description: "Fictional NXQX-Web example for a cleaning service.", keywords: ["cleaning service", "house cleaning", "office cleaning", "move out cleaning", "quote"] },
  leads: { enabled: false, endpoint: "", formKey: "" },
  analytics: { enabled: false, endpoint: "", ingestKey: "", consentRequired: true, consentVersion: "v1", clicks: true, scrollDepth: true, mouseTracking: false },
  demo: { fictional: true, salesUseOnly: true, liveLeadCapture: false, liveAnalytics: false },
};
