// Offline test: one unexpected response or bug must never blank the whole screen. The app has an error safety net with a calm message, and the
// launch journey (read in three places) is checked once where it arrives instead of crashing on an empty or malformed response.
import fs from "node:fs";
import { parseLaunchJourney } from "../src/lib/clientJourney.ts";

let failures = 0;
function check(name, ok, detail = "") { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); } }

const good = { client_id: "c", business_name: "B", client_status: "approved", project_id: null, stage_key: "s", stage_title: "T", stage_detail: "D", progress_percent: 40, attention_required: false,
  next_action: { owner: "client", title: "Do it", detail: "Now", href: "/client" }, milestones: [{ key: "a", title: "A", status: "complete", detail: "" }], requirements: [], generated_at: "x" };
check("a complete journey passes through unchanged", (() => { const r = parseLaunchJourney(good); return r !== null && r.next_action.owner === "client" && r.next_action.title === "Do it" && r.milestones.length === 1 && r.progress_percent === 40; })());
check("an empty, null, string or array response means no journey, never a crash", parseLaunchJourney({}) === null && parseLaunchJourney(null) === null && parseLaunchJourney("x") === null && parseLaunchJourney(5) === null && parseLaunchJourney([]) === null);
check("a journey without a usable next step is refused", parseLaunchJourney({ ...good, next_action: null }) === null && parseLaunchJourney({ ...good, next_action: { owner: "client" } }) === null && parseLaunchJourney({ ...good, next_action: { title: 5, href: "/x" } }) === null);
check("missing lists become empty lists and an unknown owner becomes NXQX (the safe side)", (() => { const r = parseLaunchJourney({ ...good, milestones: undefined, requirements: "nope", next_action: { owner: "weird", title: "T", href: "/x" } }); return r !== null && Array.isArray(r.milestones) && r.milestones.length === 0 && Array.isArray(r.requirements) && r.next_action.owner === "nxq" && r.next_action.detail === ""; })());

const topCards = fs.readFileSync("src/components/ClientPortalTopCards.tsx", "utf8");
const portal = fs.readFileSync("src/pages/ClientPortal.tsx", "utf8");
const journeyPage = fs.readFileSync("src/pages/ClientLaunchJourney.tsx", "utf8");
check("all three places that read the journey check it first", /parseLaunchJourney\(journeyResult\.data\)/.test(topCards) && /setJourney\(parseLaunchJourney\(journeyResult\.data\)\)/.test(portal) && /parseLaunchJourney\(result\.data\)/.test(journeyPage) && !/as ClientLaunchJourney\)/.test(portal) && !/journeyResult\.data as ClientLaunchJourney/.test(topCards));
check("the journey page never shows the technical error text to a client", !/result\.error\.message/.test(journeyPage) && /Your website journey could not load right now\. Please try again shortly\./.test(journeyPage));

const boundary = fs.readFileSync("src/components/AppErrorBoundary.tsx", "utf8");
const app = fs.readFileSync("src/App.tsx", "utf8");
check("the app has an error boundary wrapped around every route", /getDerivedStateFromError/.test(boundary) && /componentDidCatch/.test(boundary) && /<AppErrorBoundary><Suspense[\s\S]*<AppRoutes \/><\/Suspense><\/AppErrorBoundary>/.test(app) && /import \{ AppErrorBoundary \}/.test(app));
check("the fallback is calm: an alert, a plain message, a reload button and a way back, and no technical text", /role="alert"/.test(boundary) && /Something went wrong/.test(boundary) && /Reload this page/.test(boundary) && /Go to the home page/.test(boundary) && !/error\.message|\.stack|String\(error\)/.test(boundary.replace(/console\.error\([^;]*\);/, "")));
check("the technical error goes only to the browser console", /console\.error\("Page error:", error, info\.componentStack\)/.test(boundary));
check("a store page keeps its light look and links back to the store, not the NXQX home page", /isStore \? " store-theme" : ""/.test(boundary) && /Back to the store/.test(boundary) && /slice\(0, 2\)/.test(boundary));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll app-resilience checks passed (offline).");
process.exit(failures ? 1 : 0);
