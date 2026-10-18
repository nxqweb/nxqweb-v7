// Fictional example business for NXQX-Web sales. It contains no real business identity, reviews, certifications, prices, guarantees or response times.
export const siteConfig = {
  schemaVersion: "nxq-business-v1",
  business: { name: "Studio Juniper Salon", type: "Hair salon", phone: "", email: "", serviceArea: "Your Neighborhood" },
  brand: {
    eyebrow: "A salon website that is easy to book from",
    headline: "Your next appointment, made clear.",
    subheadline: "A fictional salon website that lists the services, shows how to ask for an appointment and keeps the details in one place.",
    primaryCta: "Request an Appointment",
    secondaryCta: "See Services",
  },
  services: [
    { title: "Cuts and Styling", description: "A simple list of cutting and styling services, so a visitor knows what to ask for." },
    { title: "Color", description: "An overview of color services, with a prompt to describe what the customer has in mind." },
    { title: "Treatments", description: "Space to explain conditioning and care services in plain words." },
    { title: "Event Hair", description: "A request path for weddings, parties and special days, with room for the date and group size." },
    { title: "Consultations", description: "A way to ask a question before booking, for customers who want to talk it through." },
    { title: "Gift Cards", description: "A place to explain gift options and how to buy them." },
  ],
  trust: { heading: "From idea to appointment request", points: ["Services listed clearly", "Appointment requests in one place", "Easy on a phone", "Questions welcome before booking"] },
  about: { heading: "Built for how people choose a salon", body: "This fictional demo shows how NXQX-Web can present services and appointment requests without inventing reviews, awards or claims. A real salon site would use the owner's own services, team and photos." },
  seo: { title: "Studio Juniper Salon | Example site", description: "Fictional NXQX-Web example for a hair salon.", keywords: ["hair salon", "haircut", "hair color", "appointment", "event hair"] },
  leads: { enabled: false, endpoint: "", formKey: "" },
  analytics: { enabled: false, endpoint: "", ingestKey: "", consentRequired: true, consentVersion: "v1", clicks: true, scrollDepth: true, mouseTracking: false },
  demo: { fictional: true, salesUseOnly: true, liveLeadCapture: false, liveAnalytics: false },
};
siteConfig.design = { themeKey: "royal_violet" };
