// Static contract check: every supabase `.rpc("name", { ... })` call in src/ and
// supabase/functions/ must (a) name a function defined in supabase/migrations and
// (b) pass only argument names that function declares, including every required
// (no-default) argument. PostgREST resolves RPCs by argument NAMES, so a renamed or
// misspelled key fails at runtime with "function not found", which the callers
// then usually report as an unrelated business error. Overloads are unioned.
// Source-level only: does not prove live database behavior.
import fs from "node:fs";
import path from "node:path";
import { balancedEnd, collectRpcCallSites, splitTop, walk } from "./lib/rpc-call-sites.mjs";

const root = process.cwd();
let failures = 0;
const fail = (message) => { failures += 1; console.error(`FAIL ${message}`); };

// 1. Function signatures from migrations (all overloads, all definitions).
const functions = new Map(); // name -> [{ names: string[], required: Set<string> }]
for (const file of walk(path.join(root, "supabase/migrations"), [".sql"])) {
  const sql = fs.readFileSync(file, "utf8").replace(/--[^\n]*/g, "");
  const re = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?(\w+)"?\s*\(/gi;
  let match;
  while ((match = re.exec(sql))) {
    const open = match.index + match[0].length - 1;
    const close = balancedEnd(sql, open);
    if (close === -1) continue;
    const names = []; const required = new Set(); let positionalOnly = false;
    for (const raw of splitTop(sql.slice(open + 1, close))) {
      const arg = raw.trim().replace(/^(in|inout|variadic)\s+/i, "");
      if (!arg || /^out\s/i.test(arg)) continue;
      const nameMatch = /^"?([a-z_][\w]*)"?\s+\S/i.exec(arg);
      if (!nameMatch) { positionalOnly = true; continue; }
      names.push(nameMatch[1]);
      if (!/\sdefault\s|\s=\s/i.test(arg)) required.add(nameMatch[1]);
    }
    if (positionalOnly) continue;
    if (!functions.has(match[1])) functions.set(match[1], []);
    functions.get(match[1]).push({ names, required });
  }
}

// 2. RPC call sites (shared scanner).
let sites = 0; let skipped = 0;
for (const site of collectRpcCallSites(root)) {
  const where = `${site.file} -> ${site.name}`;
  sites += 1;
  const overloads = functions.get(site.name);
  if (!overloads) { fail(`${where}: no function with this name is defined in supabase/migrations`); continue; }
  if (site.keys === null) { skipped += 1; continue; }
  const matches = overloads.some((o) => site.keys.every((k) => o.names.includes(k)) && [...o.required].every((r) => site.keys.includes(r)));
  if (!matches) {
    const signatures = overloads.map((o) => `(${o.names.join(", ")}; required: ${[...o.required].join(", ") || "none"})`).join(" | ");
    fail(`${where}: arguments {${site.keys.join(", ")}} match no definition ${signatures}`);
  }
}

console.log(`${sites} RPC call sites checked (${skipped} with non-literal arguments skipped), ${functions.size} functions defined.`);
if (failures) { console.error(`${failures} RPC argument contract failure(s).`); process.exit(1); }
console.log("PASS RPC call arguments match their database function definitions.");
