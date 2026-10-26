// Offline test for the screen attention map (Intelligence heat-map): the pure logic, the OFF switch, honest wording, and that the database function is only reached through the
// draft gateway (docs/drafts/ui), never from src/. The database rules themselves are proven on real Postgres by docs/drafts/migrations/13_screen_attention_map.test.sql.
import fs from "node:fs";
import {
  attentionCopy, attentionErrorMessage, attentionGrid, attentionHottest, attentionLevel, attentionOffMessage, attentionPlace, attentionSentence, parseAttentionMap,
} from "../src/lib/screenAttentionMap.ts";
import { screenAttentionGateway } from "../src/lib/screenAttentionMapConfig.ts";

let failures = 0;
function check(name, ok) { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}`); } }
const read = (p) => fs.readFileSync(p, "utf8");

check("the one switch is OFF (null) until migration 279 is applied", screenAttentionGateway === null);
check("levels: zero stays 0, any real cell is at least 1, the busiest is 5, and bad input is 0",
  attentionLevel(0, 10) === 0 && attentionLevel(1, 1000) === 1 && attentionLevel(10, 10) === 5 && attentionLevel(5, 10) === 3 && attentionLevel(3, 0) === 0 && attentionLevel(Number.NaN, 5) === 0);
const cells = [{ x: 8, y: 1, points: 51 }, { x: 8, y: 5, points: 12 }, { x: 99, y: 1, points: 7 }, { x: 2, y: -1, points: 7 }, { x: 3, y: 3, points: 0 }];
const grid = attentionGrid(cells, 16, 10);
check("the grid is rows x cols, places real cells, and ignores cells outside it or empty", grid.length === 10 && grid[0].length === 16 && grid[1][8] === 51 && grid[5][8] === 12 && grid.flat().reduce((a, b) => a + b, 0) === 63);
check("the hottest cell is found", JSON.stringify(attentionHottest(cells, 16, 10)) === JSON.stringify({ x: 8, y: 1, points: 51 }) && attentionHottest([], 16, 10) === null);
check("places are plain words", attentionPlace(0, 0, 16, 10) === "top left of the screen" && attentionPlace(15, 9, 16, 10) === "bottom right of the screen" && attentionPlace(8, 5, 16, 10) === "middle of the screen" && attentionPlace(0, 5, 16, 10) === "left side of the screen" && attentionPlace(8, 0, 16, 10) === "top of the screen");
const parsed = parseAttentionMap({ enabled: true, days: 30, cols: 16, rows: 10, pages: [{ path: "/", points: 67, sessions: 15 }, { path: "", points: 1, sessions: 1 }], page: "/", points: 67, sessions: 15, cells: [{ x: 8, y: 1, points: 51 }] });
check("parsing keeps good data and drops pages without a path", parsed.enabled === true && parsed.pages.length === 1 && parsed.cells[0].points === 51);
check("sentence names the visits and the busiest place", attentionSentence(parsed).includes("15 visits") && attentionSentence(parsed).includes("top of the screen") && attentionSentence(parsed).includes("Most attention:"));
check("anything unexpected parses as not enabled, never as an invented picture", ["", null, 5, [], { enabled: "yes" }].every((raw) => parseAttentionMap(raw).enabled === false) && parseAttentionMap({ enabled: false, reason: "mouse_tracking_off" }).reason === "mouse_tracking_off");
check("a plan refusal says upgrade; any other failure says it could not load", attentionErrorMessage(new Error("The screen attention map is not included in this plan.")) === attentionCopy.upgrade && attentionErrorMessage(new Error("boom")) === attentionCopy.failed && attentionErrorMessage("x") === attentionCopy.failed);
check("tracking-off reasons say tracking is off; others say waiting for approval", attentionOffMessage("mouse_tracking_off") === attentionCopy.off && attentionOffMessage("no_analytics_profile") === attentionCopy.off && attentionOffMessage("x") === attentionCopy.waiting);
check("copy is honest: screen not page, consent, privacy thresholds, no AI/heat-map-of-the-page claims", /not of the whole page/.test(attentionCopy.how) && /agreed to tracking/.test(attentionCopy.how) && /10 different visits/.test(attentionCopy.privacy) && /3\./.test(attentionCopy.privacy) && !/heat.?map of (your|the) (page|website)/i.test(attentionCopy.how));

// wiring
const app = read("src/App.tsx");
check("the route /client/attention is registered", /path === "\/client\/attention"\) return <ClientAttentionRoute \/>/.test(app));
const rpcInSrc = [];
const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const f = `${dir}/${e.name}`; if (e.isDirectory()) walk(f); else if (/\.(ts|tsx)$/.test(e.name) && /\.rpc\(\s*"current_client_screen_attention_map"/.test(read(f))) rpcInSrc.push(f); } };
walk("src");
check("only the gateway file calls the database function (the page and component never do)", rpcInSrc.length === 1 && rpcInSrc[0].endsWith("screenAttentionMapSupabaseGateway.ts") && true);
check("the page reads only through the config switch and the component shows a not-switched-on message while null", /screenAttentionGateway/.test(read("src/pages/ClientAttentionRoute.tsx")) && /attention-not-on/.test(read("src/components/ClientScreenAttentionMap.tsx")));

if (failures) { console.log(`\n${failures} check(s) FAILED`); process.exit(1); }
console.log("\nAll checks passed.");
