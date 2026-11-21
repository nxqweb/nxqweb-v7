// Plain-words meanings for words clients may not know. Shown by the small "?" button next to the word (HelpTerm). Keep every meaning short, true,
// and free of other jargon. These explain; they never promise a result.
export const helpTerms = {
  seo: { name: "SEO", meaning: "Short for search engine optimization. It means helping people find your website when they search on Google: clear page titles, the words people really search for, and the places you serve." },
  conversion: { name: "Conversion", meaning: "When a visitor does the thing you want, like calling you, sending a message or placing an order. A better conversion means more of your visitors take that step." },
  cta: { name: "Call to action", meaning: "A button or line that tells a visitor what to do next, such as Call now or Get a free quote." },
  lead: { name: "Lead", meaning: "A person who showed interest in your business, for example by filling in your contact form or calling." },
  analytics: { name: "Analytics", meaning: "Simple numbers about how people use your website: how many visit, which pages they open and what they click. It never records what visitors type." },
  heatmap: { name: "Heat map", meaning: "A picture of where visitors click and how far they scroll on a page, so you can see what gets attention. It only runs with the visitor's consent." },
  domain: { name: "Domain", meaning: "Your website's address, like yourbusiness.com." },
  dns: { name: "DNS", meaning: "The setting at your domain company that points your address to your website. We tell you exactly what to enter; you do not need to understand it." },
  registrar: { name: "Registrar", meaning: "The company where you bought your domain, for example GoDaddy or Namecheap." },
  sku: { name: "SKU", meaning: "Your own code for a product, like CANDLE-VAN-8. Totally optional. Leave it empty if you do not use codes." },
  compareAt: { name: "Compare-at price", meaning: "The old or full price. If you fill it in and it is higher than your price, customers see the sale." },
  variant: { name: "Variant", meaning: "One version of a product, such as a size, color or scent. Most products only need one." },
} as const;

export type HelpTermKey = keyof typeof helpTerms;
