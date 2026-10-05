// Contract test for the premium UI layer (static; no browser). It protects what must NOT change when the
// look changes: every destination the old public pages linked to, honest public claims, the empty
// "Trusted by" default, the light-theme escape hatch, and that the backdrop never sits behind storefronts.
import fs from "node:fs";

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`PASS  ${name}`);
  else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); }
}
const read = (file) => fs.readFileSync(file, "utf8");
const home = read("src/pages/PublicHome.tsx");
const plans = read("src/pages/PublicPlans.tsx");
const selector = read("src/components/ProductFamilySignupSelector.tsx");
const security = read("src/components/SecurityBand.tsx");
const trusted = read("src/components/TrustedBy.tsx");
const proof = read("src/lib/socialProof.ts");
const demo = read("src/components/PortalPreviewDemo.tsx");
const backdrop = read("src/components/PremiumBackdrop.tsx");
const wipe = read("src/lib/usePageWipe.ts");
const css = read("src/styles/premium-v2.css");
const app = read("src/App.tsx");

// ---- destinations that existed before the redesign ----
check("home still links to the client portal", home.includes('href="/portal"'));
check("home still links the Growth signup call to action", home.includes("/portal/signup?family=business&tier=growth"));
check("home builds each tier signup link from the catalog", home.includes("/portal/signup?family=business&tier=${encodeURIComponent(tier.key)}"));
check("home still links to the full plans page", home.includes('href="/plans"'));
for (const anchor of ["#systems", "#pricing", "#process"]) {
  check(`home keeps the ${anchor} anchor and a link to it`, home.includes(`href="${anchor}"`) && home.includes(`id="${anchor.slice(1)}"`));
}
check("plans page links back home and to signup", plans.includes('href="/"') && plans.includes("/portal/signup?family=business&tier=${tier.key}") && plans.includes("/portal/signup?family=business&tier=growth"));
check("family cards keep their signup link and disabled state for planned families", selector.includes("/portal/signup?family=${encodeURIComponent(family.slug)}") && selector.includes('aria-disabled="true"') && selector.includes("isPubliclySelectableFamily(family)"));
check("pricing still comes from the single catalog", home.includes("productTiers.map") && plans.includes("productTiers.map") && !/\$\d+\/mo/.test(home + plans));

// ---- honest public claims ----
const publicText = [home, plans, security, selector].join("\n");
check("no guarantee, certification or audit claims on public pages", !/guarante(?:e|ed) (?:results|rankings|leads|uptime)|\b(?:SOC ?2|ISO ?27001|HIPAA|PCI[- ]DSS|GDPR[- ]compliant|bank[- ]grade|military[- ]grade|unhackable|100% secure)\b/i.test(publicText));
check("security band says it describes the approach, not a guarantee", /rather than promising that nothing can ever go wrong/.test(security));
check("home keeps the owner-review and managed-service promises", /Owner-reviewed where it matters/.test(home) && /managed website/i.test(home));
check("the portal preview is labeled as illustrative sample data", /Illustrative sample data/.test(demo) && /ILLUSTRATIVE sample data/.test(demo) && !/supabase|fetch\(/i.test(demo));
check("the example site on the home page is labeled as an example", /Example site for illustration only/.test(home));
check("the Trusted-by list ships empty and renders nothing while empty", /clientResults: ClientResult\[\] = \[\];/.test(proof) && /if \(clientResults\.length === 0\) return null;/.test(trusted));
check("home has no external links or scripts", !/https?:\/\//.test(home.replace(/\/\/ .*$/gm, "")) );

// ---- safety of the layer itself ----
check("page wipe only affects same-origin links and always falls back to navigation", wipe.includes("url.origin !== window.location.origin") && wipe.includes("window.location.assign(url.href)") && wipe.includes("event.metaKey"));
check("wipe is used only on internal path links", [...home.matchAll(/data-px-wipe\s+href="([^"]+)"/g)].every((m) => m[1].startsWith("/")));
check("backdrop never intercepts clicks and is hidden from assistive tech", /\.px-bg\{[^}]*pointer-events:none/.test(css) && backdrop.includes('aria-hidden="true"'));
check("backdrop is not mounted for public storefronts", /path\.startsWith\("\/store"\)\) return null/.test(app));
check("light theme hides the backdrop and the app skin is dark-theme only", css.includes('body[data-nxq-theme="light"] .px-bg') && !/body\[data-nxq-theme="light"\][^{]*\{[^}]*color/.test(css.split("App skin")[1] || ""));
check("reduced motion turns the animation off", /@media \(prefers-reduced-motion:reduce\)\{[^]*animation:none!important/.test(css));
check("app routing and guards are untouched by the layer (App.tsx still has guard strings)", app.includes("<OwnerProtectedRoute>") && app.includes('window.location.replace("/portal/login")') && app.includes('id="main-content" tabIndex={-1}'));

console.log(failures ? `\n${failures} premium UI contract check(s) FAILED.` : "\nAll premium UI contract checks passed.");
process.exit(failures ? 1 : 0);
