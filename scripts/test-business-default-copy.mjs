// Offline test: the default and industry-preset website copy makes no claim the grounding validator rejects, for any kind of business.
import fs from "node:fs";
import * as copy from "../supabase/functions/_shared/business-default-copy.ts";
import { getBusinessIndustryPreset, getPresetServiceDescription } from "../supabase/functions/_shared/business-industry-presets.ts";
import { findUnsupportedMarketingClaims } from "../supabase/functions/_shared/ai-grounding.mjs";

let failures = 0;
function check(name, ok, detail = "") { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); } }

const businesses = [
  { name: "Acme Plumbing", type: "plumbing", area: "Butte County", services: ["Drain cleaning", "Water heater repair"] },
  { name: "Sunrise Dental", type: "dental practice", area: "", services: ["Cleanings", "Whitening"] },
  { name: "Bella Salon", type: "hair salon", area: "Downtown Austin", services: ["Cuts", "Color"] },
  { name: "Local Business", type: "local service business", area: "", services: [] },
  { name: "Green Roots", type: "tree service", area: "Chico", services: ["Tree removal", "Stump grinding", "Storm cleanup", "Emergency cleanup"] },
];

for (const b of businesses) {
  const strategy = {
    positioning: copy.defaultAboutBody(b.name, b.type),
    value_proposition: copy.defaultSubheadline(b.type),
    hero: { eyebrow: copy.defaultEyebrow(b.area), headline: copy.defaultHeadline(b.name), subheadline: copy.defaultSubheadline(b.type) },
    service_descriptions: (b.services.length ? b.services : [copy.defaultFallbackServiceTitle]).map((service) => ({ service, description: copy.defaultServiceDescription(service, b.type) })),
    trust_points: [copy.defaultTrustHeading, ...copy.defaultTrustPoints(b.area)],
    about_summary: copy.defaultAboutBody(b.name, b.type),
  };
  const input = { business_name: b.name, business_type: b.type, service_area: b.area, services: b.services, goals: "" };
  check(`default copy makes no unsupported claims (${b.name})`, findUnsupportedMarketingClaims(strategy, input).length === 0, findUnsupportedMarketingClaims(strategy, input).join(", "));
  check(`default about heading is a plain label (${b.name})`, copy.defaultAboutHeading(b.name) === `About ${b.name}`);

  const preset = getBusinessIndustryPreset(b.type);
  if (preset) {
    const presetStrategy = {
      positioning: preset.aboutBody(b.name, b.area), value_proposition: preset.heroSubheadline,
      hero: { eyebrow: preset.heroEyebrow(b.area), headline: preset.heroHeadline(b.name), subheadline: preset.heroSubheadline },
      service_descriptions: b.services.map((service) => ({ service, description: getPresetServiceDescription(preset, service) })),
      trust_points: [preset.trustHeading, ...preset.trustPoints], about_summary: preset.aboutBody(b.name, b.area),
    };
    check(`industry preset copy makes no unsupported claims (${b.name})`, findUnsupportedMarketingClaims(presetStrategy, input).length === 0, findUnsupportedMarketingClaims(presetStrategy, input).join(", "));
    const noArea = { ...presetStrategy, hero: { ...presetStrategy.hero, eyebrow: preset.heroEyebrow("") } };
    check(`industry preset copy without a service area makes no claims (${b.name})`, findUnsupportedMarketingClaims(noArea, { ...input, service_area: "" }).length === 0);
  }
}

const build = fs.readFileSync("supabase/functions/build-business-website/index.ts", "utf8");
check("website builder uses the shared default copy", build.includes('import * as defaultCopy from "../_shared/business-default-copy.ts"') && build.includes("defaultCopy.defaultHeadline(businessName)"));
check("website builder no longer ships 'Trusted local service' / 'Professional service. Clear results.' defaults", !build.includes("Trusted local service") && !build.includes("Professional service. Clear results.") && !build.includes("Built around trust and reliable service"));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll business default-copy checks passed (offline).");
process.exit(failures ? 1 : 0);
