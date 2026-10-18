// The AI Desk gateway: the draft Supabase connection must call exactly the functions/arguments the draft SQL defines, and the safe
// status parser must never crash on odd data. Offline, no network. Node >= 22.18 imports the .ts helper directly.
import fs from "node:fs";
import { deskStatusFromRow } from "../src/lib/aiDeskGateway.ts";

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`PASS  ${name}`);
  else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); }
}

const gateway = fs.readFileSync("src/lib/aiDeskSupabaseGateway.ts", "utf8");
const sql = fs.readFileSync("supabase/migrations/277_ai_desk_build_plans.sql", "utf8");

function sqlArgs(name) {
  const match = sql.match(new RegExp(`create or replace function public\\.${name}\\(([^)]*)\\)`));
  return match ? match[1].split(",").map((part) => part.trim().split(/\s+/)[0]).filter(Boolean) : null;
}
function callArgs(name) {
  const match = gateway.match(new RegExp(`rpc\\("${name}"(?:,\\s*\\{([^}]*)\\})?`));
  return match ? (match[1] || "").split(",").map((part) => part.split(":")[0].trim()).filter(Boolean) : null;
}
for (const name of ["get_ai_desk_status", "save_ai_desk_build_plan"]) {
  const wanted = sqlArgs(name);
  const got = callArgs(name);
  check(`gateway calls ${name} with exactly the SQL's argument names`, Boolean(wanted) && Boolean(got) && JSON.stringify(wanted) === JSON.stringify(got), `sql=${wanted} gateway=${got}`);
}

// Control: a renamed argument would be caught.
check("control: the comparison notices a wrong argument name", JSON.stringify(sqlArgs("get_ai_desk_status")) !== JSON.stringify(["client_id"]));

// Where the real calls live, and the one switch that keeps them off until migration 277 is applied.
const srcFiles = [];
(function walk(dir) { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const full = `${dir}/${entry.name}`; if (entry.isDirectory()) walk(full); else if (/\.(ts|tsx)$/.test(entry.name)) srcFiles.push(full); } })("src");
check("only the gateway file calls the two AI Desk functions from src/", srcFiles.filter((f) => /rpc\(\s*"(?:get_ai_desk_status|save_ai_desk_build_plan)"/.test(fs.readFileSync(f, "utf8"))).join() === "src/lib/aiDeskSupabaseGateway.ts");
check("the gateway is imported nowhere yet (the switch is what turns Save to project on)", !srcFiles.some((f) => f !== "src/lib/aiDeskSupabaseGateway.ts" && /from\s+["'][^"']*aiDeskSupabaseGateway/.test(fs.readFileSync(f, "utf8"))));
const config = fs.readFileSync("src/lib/aiDeskConfig.ts", "utf8");
check("the one switch is still null (it is turned on only AFTER migration 277 is applied)", /export const aiDeskGateway: AiDeskGateway \| null = null;/.test(config) && !/= createAiDeskGateway/.test(config));
const ownerScreen = fs.readFileSync("src/pages/OwnerPortal.tsx", "utf8");
check("the owner screen hands the panel the switch, nothing else", ownerScreen.includes("gateway={aiDeskGateway}") && ownerScreen.includes('from "../lib/aiDeskConfig"'));
check("the real SQL the gateway points at is a real migration (not a draft)", fs.existsSync("supabase/migrations/277_ai_desk_build_plans.sql") && !fs.existsSync("docs/drafts/migrations/09_ai_desk_build_plans.sql"));

// Status parser
check("a waiting row keeps its request", deskStatusFromRow({ status: "waiting", request: { task: "x" } }).request?.task === "x");
check("only a waiting row exposes a request (never an old one)", deskStatusFromRow({ status: "saved", request: { task: "x" } }).request === null && deskStatusFromRow({ status: "used", request: { task: "x" } }).request === null);
check("an unknown status becomes none", deskStatusFromRow({ status: "weird" }).status === "none");
check("null, text, arrays and numbers never crash", ["none", "none", "none", "none"].every((s, i) => deskStatusFromRow([null, "hi", [1], 5][i]).status === s));
check("dates and errors pass through as text only", deskStatusFromRow({ status: "used", used_at: "2026-10-18T10:00:00Z", last_error: "nope" }).usedAt === "2026-10-18T10:00:00Z" && deskStatusFromRow({ last_error: 5 }).lastError === null);

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll AI Desk gateway checks passed.");
process.exit(failures ? 1 : 0);
