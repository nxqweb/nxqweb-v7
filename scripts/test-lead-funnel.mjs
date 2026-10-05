// Logic tests for src/lib/leadFunnel.ts (Node runs the TypeScript directly; no build step).
import fs from "node:fs";
import { buildFunnel, percent } from "../src/lib/leadFunnel.ts";

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`PASS  ${name}`);
  else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); }
}

// Wednesday 2026-10-07 12:00 local. Current week starts Monday 2026-10-05.
const NOW = new Date(2026, 9, 7, 12, 0, 0).getTime();
const at = (y, m, d) => new Date(y, m - 1, d, 10, 0, 0).toISOString();
const lead = (status, created, extra = {}) => ({ status, created_at: created, service_key: "tree_removal", urgency: "normal", ...extra });

const empty = buildFunnel([], NOW);
check("empty input gives zero stages and no fake percentages", empty.stages.every((s) => s.count === 0) && empty.conversion.overall === null && percent(empty.conversion.contacted) === "—");
check("empty input still returns 8 weekly buckets of zero", empty.weekly.length === 8 && empty.weekly.every((w) => w.value === 0));

const leads = [
  lead("new", at(2026, 10, 6)),
  lead("new", at(2026, 10, 5)),
  lead("contacted", at(2026, 10, 1)),
  lead("qualified", at(2026, 9, 29)),
  lead("won", at(2026, 9, 22)),
  lead("lost", at(2026, 9, 15)),
  lead("spam", at(2026, 10, 6)),
  lead("archived", at(2026, 7, 1)),
];
const f = buildFunnel(leads, NOW);
const count = (key) => f.stages.find((s) => s.key === key).count;
check("spam is excluded from every stage and reported separately", f.spam === 1 && count("received") === 7 && f.total === 8);
check("a won lead also counts as contacted and qualified", count("contacted") === 3 && count("qualified") === 2 && count("won") === 1);
check("lost and archived leads count only as received", count("received") - count("contacted") === 4);
check("stages never grow down the funnel", count("received") >= count("contacted") && count("contacted") >= count("qualified") && count("qualified") >= count("won"));
check("step conversion uses the previous stage as denominator", Math.abs(f.conversion.contacted - 3 / 7) < 1e-9 && Math.abs(f.conversion.qualified - 2 / 3) < 1e-9 && f.conversion.won === 0.5);
check("overall conversion is won / received", Math.abs(f.conversion.overall - 1 / 7) < 1e-9 && percent(f.conversion.overall) === "14%");

const noContact = buildFunnel([lead("new", at(2026, 10, 6))], NOW);
check("a stage with nothing before it reports no rate, not 0%", noContact.conversion.qualified === null && noContact.conversion.won === null);

// Weekly buckets: current week = Mon Oct 5; previous = Sep 28; Sep 21; Sep 14 ...
const week = Object.fromEntries(f.weekly.map((w) => [w.date, w.value]));
check("buckets are Monday-based and end with the current week", f.weekly[7].date === "2026-10-05" && f.weekly[6].date === "2026-09-28" && f.weekly[0].date === "2026-08-17");
check("leads land in the right week", week["2026-10-05"] === 2 && week["2026-09-28"] === 2 && week["2026-09-21"] === 1 && week["2026-09-14"] === 1);
check("spam is not counted in the weekly chart", f.weekly.reduce((t, w) => t + w.value, 0) === 6);
check("leads older than the window stay in the funnel but not the weekly chart", count("received") === 7 && f.weekly.reduce((t, w) => t + w.value, 0) === 6);
check("a Sunday belongs to the week that started the previous Monday", buildFunnel([lead("new", at(2026, 10, 4))], NOW).weekly.find((w) => w.date === "2026-09-28").value === 1);
check("an unparseable date is ignored without crashing", buildFunnel([lead("new", "not a date")], NOW).weekly.every((w) => w.value === 0));

const mixed = buildFunnel([
  lead("won", at(2026, 10, 6), { service_key: "stump_grinding" }),
  lead("new", at(2026, 10, 6), { service_key: "stump_grinding" }),
  lead("new", at(2026, 10, 6), { service_key: "tree_removal" }),
  lead("new", at(2026, 10, 6), { service_key: null }),
  lead("new", at(2026, 10, 6), { service_key: "  " }),
], NOW);
check("services group by key, blank becomes Not specified, sorted by volume", mixed.services[0].service === "Not specified" && mixed.services[0].total === 2 && mixed.services[1].service === "stump_grinding" && mixed.services[1].won === 1);
const many = buildFunnel(Array.from({ length: 10 }, (_, i) => lead("new", at(2026, 10, 6), { service_key: `svc_${i}` })), NOW);
check("only the top 6 services are listed", many.services.length === 6);
check("urgent and emergency leads are counted, spam excluded", buildFunnel([lead("new", at(2026, 10, 6), { urgency: "urgent" }), lead("new", at(2026, 10, 6), { urgency: "emergency" }), lead("spam", at(2026, 10, 6), { urgency: "urgent" }), lead("new", at(2026, 10, 6))], NOW).urgent === 2);


// ---- Page / wiring contract (static) ----
const read = (file) => fs.readFileSync(file, "utf8");
const page = read("src/pages/ClientBusinessFunnel.tsx");
const app = read("src/App.tsx");
const dashboard = read("src/pages/ClientBusinessDashboard.tsx");
check("funnel page reads leads only through the tenant-safe client RPC (no direct table reads)", page.includes('rpc("current_client_leads_page"') && !/\.from\(["']/.test(page));
check("funnel page sends signed-out visitors to sign-in", page.includes('window.location.replace("/portal/login")'));
check("a failed fetch shows no figures instead of partial numbers", page.includes("No figures are shown") && page.includes("setVerified(false)"));
check("empty state is honest and invents no numbers", page.includes("No leads yet"));
check("page never claims to be live and says when it was updated", !/\blive\b/i.test(page) && page.includes("updatedLabel"));
check("page is honest that lead source breakdowns are not part of this view", page.includes("Per-source and campaign breakdowns are not part of this view"));
check("page discloses when it is based on a capped number of leads", page.includes("Based on your most recent"));
check("route /client/business/funnel is registered", app.includes('path === "/client/business/funnel"') && app.includes("ClientBusinessFunnel"));
check("the Business workspace links to the funnel page", dashboard.includes('href="/client/business/funnel"'));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll lead funnel checks passed.");
process.exit(failures ? 1 : 0);
