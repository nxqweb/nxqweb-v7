// Fictional example business for NXQX-Web sales. It contains no real business identity, reviews, certifications, prices, guarantees or response times.
export const siteConfig = {
  schemaVersion: "nxq-business-v1",
  business: { name: "Harbor & Pine Cafe", type: "Cafe and bakery", phone: "", email: "", serviceArea: "Your Neighborhood" },
  brand: {
    eyebrow: "A neighborhood cafe, made easy to find",
    headline: "Fresh drinks. Easy to find.",
    subheadline: "A fictional cafe website that shows the menu, hours, location and ordering options in one clear page.",
    primaryCta: "See the Menu",
    secondaryCta: "Find Us",
  },
  services: [
    { title: "Coffee and Tea", description: "A simple list of hot and iced drinks, so a visitor sees what is on offer before they arrive." },
    { title: "Breakfast", description: "Morning items laid out clearly, with notes for the choices a customer asks about most." },
    { title: "Baked Goods", description: "A tidy page for pastries, bread and seasonal bakes, updated by the owner when the menu changes." },
    { title: "Lunch", description: "A short lunch menu with easy-to-read sections and the details a customer needs." },
    { title: "Catering Requests", description: "A simple way for offices and groups to ask about orders for events." },
    { title: "Gift Cards and Merchandise", description: "Space to explain gift options and anything sold at the counter." },
  ],
  trust: { heading: "A clear path from craving to counter", points: ["Menu that is easy to read", "Hours and address up front", "Phone-friendly layout", "Simple catering requests"] },
  about: { heading: "Built for how people look for a cafe", body: "This fictional demo shows how NXQX-Web can present a menu, hours, location and group-order requests without inventing awards, reviews or claims. A real cafe site would use the owner's own menu, photos and details." },
  seo: { title: "Harbor & Pine Cafe | Example site", description: "Fictional NXQX-Web example for a cafe and bakery.", keywords: ["cafe", "bakery", "coffee", "breakfast", "catering"] },
  leads: { enabled: false, endpoint: "", formKey: "" },
  analytics: { enabled: false, endpoint: "", ingestKey: "", consentRequired: true, consentVersion: "v1", clicks: true, scrollDepth: true, mouseTracking: false },
  demo: { fictional: true, salesUseOnly: true, liveLeadCapture: false, liveAnalytics: false },
};
