// The fictional example sites shown on /examples (and used when someone asks "what would my site look like?"). Each one is the REAL client-site template
// (templates/business-v1) filled with an invented business, built into public/examples/<slug>/ by scripts/build-example-sites.mjs. They are labelled as examples,
// never as client work, and contain no reviews, certifications, prices, guarantees or response times.
export type ExampleTheme = "midnight_blue" | "charcoal_gold" | "forest_emerald" | "royal_violet";
export type ExampleSite = { slug: string; name: string; type: string; blurb: string; theme: ExampleTheme; config: string };

export const exampleSites: ExampleSite[] = [
  { slug: "canopy-ridge-tree-care", name: "Canopy Ridge Tree Care", type: "Tree service", blurb: "Estimate requests, service areas and urgent-request routing for a property-care business.", theme: "forest_emerald", config: "tree-service-demo.config.js" },
  { slug: "harbor-pine-cafe", name: "Harbor & Pine Cafe", type: "Cafe and bakery", blurb: "A menu, hours and group-order requests for a neighborhood cafe.", theme: "charcoal_gold", config: "demos/harbor-pine-cafe.config.js" },
  { slug: "bright-path-cleaning", name: "Bright Path Cleaning Co.", type: "Cleaning service", blurb: "Services and quote requests for home and office cleaning.", theme: "midnight_blue", config: "demos/bright-path-cleaning.config.js" },
  { slug: "studio-juniper-salon", name: "Studio Juniper Salon", type: "Hair salon", blurb: "Services and appointment requests for a salon.", theme: "royal_violet", config: "demos/studio-juniper-salon.config.js" },
  { slug: "northline-plumbing", name: "Northline Plumbing and Heating", type: "Plumbing and heating", blurb: "Services, service areas and urgent requests for a home-service trade.", theme: "midnight_blue", config: "demos/northline-plumbing.config.js" },
];
