// The staging fallback build plan (used when no AI provider key is set) must pass the same grounding validator prepare-build-plan applies.
// QA run #3 failed 3/3 because the canned copy said "dependable", "professional", "responsive", "safety-minded", "premium", "fast", "timely".
// Offline, no network, no secrets. Node >= 22.18 imports the .ts helper directly.
import fs from "node:fs";
import { stagingFallback } from "../supabase/functions/_shared/build-plan-staging-fallback.ts";
import { findUnsupportedMarketingClaims } from "../supabase/functions/_shared/ai-grounding.mjs";

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`PASS  ${name}`);
  else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); }
}

const pages = ["Home", "Services", "About", "Service Areas", "Contact"];
const themes = ["midnight_blue", "charcoal_gold", "forest_emerald", "royal_violet"];
const cases = [
  { n: "NXQ QA Disposable QA-E45F85D69C9A", t: "Local service business", a: "", s: ["General service", "Consultation"], style: "modern dark" },
  { n: "Acme Plumbing", t: "plumbing", a: "Butte County, California", s: ["Drain cleaning", "Water heater repair", "Leak detection"], style: "gold" },
  { n: "A Very Long Business Name That Goes On And On Past The Clip Limit Of Fifty Two Characters", t: "specialty landscape and outdoor living design and installation", a: "x".repeat(300), s: ["One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight"], style: "green" },
];

for (const c of cases) {
  const request = {
    request_fingerprint: "test-fingerprint",
    input: { business_name: c.n, business_type: c.t, service_area: c.a, desired_style: c.style },
    contract: { allowed_services: c.s, allowed_pages: pages, allowed_theme_keys: themes },
  };
  const plan = stagingFallback(request);
  const input = { business_name: c.n, business_type: c.t, service_area: c.a, services: c.s, goals: "" };
  const claims = findUnsupportedMarketingClaims(plan.strategy, input);
  check(`fallback copy makes no unsupported claims (${c.n.slice(0, 24)})`, claims.length === 0, claims.join(", "));
  check(`fallback describes every service and page once (${c.n.slice(0, 24)})`,
    plan.strategy.service_descriptions.length === c.s.length && plan.strategy.page_strategy.length === pages.length);
  const s = plan.strategy;
  check(`fallback meets prepare-build-plan length rules (${c.n.slice(0, 24)})`,
    s.positioning.length >= 20 && s.value_proposition.length >= 25 && s.hero.headline.length >= 12 && s.hero.subheadline.length >= 35
    && s.about_summary.length >= 60 && s.seo.title.length >= 12 && s.seo.description.length >= 50 && s.trust_points.length >= 3
    && s.service_descriptions.every((d) => d.description.length >= 30 && d.description.length <= 280)
    && s.seo.title.length <= 60 && s.seo.description.length <= 160 && s.hero.headline.length <= 110);
}

const index = fs.readFileSync("supabase/functions/generate-business-build-plan/index.ts", "utf8");
check("generate-business-build-plan uses the shared fallback", index.includes('from "../_shared/build-plan-staging-fallback.ts"') && !index.includes("function stagingFallback"));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll build-plan fallback checks passed (offline; does not prove a live run).");
process.exit(failures ? 1 : 0);
