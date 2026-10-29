// Offline test: the "Your visits" card under the portal hero (owner request 2026-10-25) and the tour step that teaches the new quick links. The rule: never draw or imply data that does
// not exist. The graph needs a plan with analytics, an approved client and real recorded visits; every other case says in plain words why there is no graph.
import fs from "node:fs";
import { visitsGraphCopy, visitsGraphMode, visitsGraphSentence } from "../src/lib/visitsGraph.ts";

let failures = 0;
function check(name, ok) { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}`); } }
const read = (p) => fs.readFileSync(p, "utf8");
const component = read("src/components/ClientVisitsGraph.tsx");
const topCards = read("src/components/ClientPortalTopCards.tsx");
const tour = read("src/components/ClientPortalTutorialOverlay.tsx");
const entitlements = read("supabase/migrations/186_canonical_business_tier_runtime.sql");
const dashboard = read("src/pages/ClientBusinessDashboard.tsx");

check("an allowed client gets the graph", visitsGraphMode({ allowed: true, reason: "allowed" }) === "graph" && visitsGraphMode({ allowed: true }) === "graph");
check("an approved Starter client (tier_not_entitled) gets the upgrade note, and so does a missing entitlement row", visitsGraphMode({ allowed: false, reason: "tier_not_entitled" }) === "upgrade" && visitsGraphMode({ allowed: false, reason: "feature_not_entitled" }) === "upgrade");
check("a client who is not approved yet is told to wait, never to upgrade (the server checks this reason first)", visitsGraphMode({ allowed: false, reason: "client_not_active" }) === "waiting");
check("anything unknown or broken shows nothing instead of guessing", ["client_missing", "feature_key_required", "", undefined, "weird"].every((r) => visitsGraphMode({ allowed: false, reason: r }) === "hidden") && visitsGraphMode(null) === "hidden" && visitsGraphMode(undefined) === "hidden" && visitsGraphMode({}) === "hidden");
check("a denied-looking answer with allowed true cannot be confused with a refusal", visitsGraphMode({ allowed: false }) === "hidden");

const row = (tier) => new RegExp(`\\('business','${tier}','advanced_analytics',(true|false)`).exec(entitlements)?.[1];
check("the upgrade note matches the plans: analytics is off for Starter and on for Growth, Intelligence and Enterprise", row("starter") === "false" && row("growth") === "true" && row("intelligence") === "true" && row("enterprise") === "true" && /included with the Growth and Intelligence plans/.test(visitsGraphCopy.upgrade));
check("the copy never promises data: empty, waiting and failed states say plainly there is nothing to show", /No visits recorded yet/.test(visitsGraphCopy.empty) && /once real visits are recorded/.test(visitsGraphCopy.empty) && /once your website is approved and live/.test(visitsGraphCopy.waiting) && /could not be loaded/.test(visitsGraphCopy.failed));
check("the week sentence shows a signed percentage, and says so when there is nothing to compare", visitsGraphSentence({ recent: 30, changePercent: 25 }) === "Page views this week: 30 (+25% vs the week before)." && visitsGraphSentence({ recent: 10, changePercent: -50 }) === "Page views this week: 10 (-50% vs the week before)." && /Not enough earlier data/.test(visitsGraphSentence(null)));

check("the card reads the client's own project rollups, last 14 days, through the same chart as the Business workspace", /from\("website_analytics_daily_rollups"\)\.select\("rollup_date,page_views,clicks"\)\.eq\("project_id", project\.data\.id\)\.order\("rollup_date", \{ ascending: false \}\)\.limit\(14\)/.test(component) && /<DailyTrendChart title="Page views per day, last 14 days"/.test(component) && /website_analytics_daily_rollups/.test(dashboard));
check("it asks the server whether analytics is allowed instead of deciding by tier name in the browser", /current_client_feature_access", \{ target_feature_key: "advanced_analytics" \}/.test(component) && !/starter|growth|intelligence/i.test(component.replace(/Growth|Intelligence/g, "")) );
check("no sample, fake or random numbers anywhere in the card", !/Math\.random|sample|fake|placeholder|demo/i.test(component + read("src/lib/visitsGraph.ts")));
check("a failure is caught and shown as a calm sentence, never thrown into the portal", /try \{[\s\S]*\} catch \{\s*set\(\{ kind: "failed" \}\);/.test(component) && /visitsGraphCopy\.failed/.test(component));
check("the card renders nothing while loading and when there is nothing to say (no flash, no empty box)", /state\.kind === "loading" \|\| state\.kind === "hidden"\) return null/.test(component));
check("it sits right under the hero, above 'At a glance', and never for a denied client", /\{!denied \? <ClientVisitsGraph \/> : null\}\s*\n\s*\{!denied \? \(\s*\n\s*<ClientOverviewGraph/.test(topCards));
check("it is a labelled section with a real heading", /<section aria-labelledby="visits-graph-title"/.test(component) && /<h2 id="visits-graph-title">/.test(component));

const stepAt = tour.indexOf('title: "Every page is one tap away"');
check("the portal tour teaches the quick links as a step, before the messages step", stepAt > 0 && stepAt < tour.indexOf('title: "Messages and files stay with the client record"') && /Scroll to the bottom of your portal home/.test(tour) && /online store/.test(tour));
check("the tour's saved-as-done key was not changed, so clients who finished it are not shown it again", /const tutorialKey = "nxq-client-portal-tutorial-v2-complete"/.test(tour));

if (failures) { console.log(`\n${failures} check(s) FAILED`); process.exit(1); }
console.log("\nAll checks passed.");
