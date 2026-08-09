export type DomainGuide = {
  provider: string;
  openPath: string[];
  recordArea: string;
};

const guides: Array<{ aliases: string[]; guide: DomainGuide }> = [
  { aliases: ["godaddy"], guide: { provider: "GoDaddy", openPath: ["My Products", "Your domain", "DNS", "Manage DNS"], recordArea: "DNS Records" } },
  { aliases: ["namecheap"], guide: { provider: "Namecheap", openPath: ["Domain List", "Manage", "Advanced DNS"], recordArea: "Host Records" } },
  { aliases: ["cloudflare"], guide: { provider: "Cloudflare", openPath: ["Websites", "Your domain", "DNS", "Records"], recordArea: "DNS management" } },
  { aliases: ["squarespace", "google domains"], guide: { provider: "Squarespace Domains", openPath: ["Domains dashboard", "Your domain", "DNS settings"], recordArea: "Custom records" } },
  { aliases: ["wix"], guide: { provider: "Wix", openPath: ["Domains", "Domain Actions", "Manage DNS Records"], recordArea: "DNS records" } },
  { aliases: ["shopify"], guide: { provider: "Shopify", openPath: ["Settings", "Domains", "Your domain", "DNS settings"], recordArea: "DNS records" } },
  { aliases: ["hover"], guide: { provider: "Hover", openPath: ["Control Panel", "Domains", "Your domain", "DNS"], recordArea: "DNS records" } },
  { aliases: ["porkbun"], guide: { provider: "Porkbun", openPath: ["Domain Management", "Details", "DNS Records"], recordArea: "DNS records" } },
];

export function getDomainGuide(registrar: string | null, dnsProvider: string | null): DomainGuide | null {
  const source = `${registrar || ""} ${dnsProvider || ""}`.trim().toLowerCase();
  if (!source) return null;
  return guides.find(({ aliases }) => aliases.some((alias) => source.includes(alias)))?.guide || null;
}

export const domainSafetyRules = [
  "Add or edit only the records NXQ lists for this domain.",
  "Do not delete MX records—those usually control business email.",
  "Do not change nameservers unless NXQ explicitly says the connection requires it.",
  "Leave TTL on Auto or the provider default unless the NXQ instructions specify another value.",
];
