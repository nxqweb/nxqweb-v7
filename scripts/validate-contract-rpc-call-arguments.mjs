// Static contract check: every supabase `.rpc("name", { ... })` call in src/ and
// supabase/functions/ must (a) name a function defined in supabase/migrations and
// (b) pass only argument names that function declares, including every required
// (no-default) argument. PostgREST resolves RPCs by argument NAMES, so a renamed or
// misspelled key fails at runtime with "function not found", which the callers
// then usually report as an unrelated business error. Overloads are unioned.
// Source-level only: does not prove live database behavior.
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
let failures = 0;
const fail = (message) => { failures += 1; console.error(`FAIL ${message}`); };

function walk(dir, exts, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, exts, out);
    else if (exts.some((ext) => entry.name.endsWith(ext))) out.push(full);
  }
  return out;
}

function splitTop(text) {
  const parts = [];
  let depth = 0; let quote = null; let current = "";
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) { current += ch; if (ch === quote && text[i - 1] !== "\\") quote = null; continue; }
    if (ch === "'" || ch === '"' || ch === "`") { quote = ch; current += ch; continue; }
    if ("([{".includes(ch)) depth += 1;
    if (")]}".includes(ch)) depth -= 1;
    if (ch === "," && depth === 0) { parts.push(current); current = ""; } else current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

function balancedEnd(text, openIndex, open = "(", close = ")") {
  let depth = 0; let quote = null;
  for (let i = openIndex; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) { if (ch === quote && text[i - 1] !== "\\") quote = null; continue; }
    if (ch === "'" || ch === '"' || ch === "`") { quote = ch; continue; }
    if (ch === open) depth += 1;
    else if (ch === close) { depth -= 1; if (depth === 0) return i; }
  }
  return -1;
}

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

// 2. RPC call sites.
function objectKeys(source) {
  const keys = [];
  for (const raw of splitTop(source.slice(1, -1))) {
    const part = raw.trim();
    if (!part) continue;
    if (part.startsWith("...")) return null;
    const key = part.split(":", 1)[0].trim().replace(/^["']|["']$/g, "");
    if (!/^\w+$/.test(key)) return null;
    keys.push(key);
  }
  return keys;
}

let sites = 0; let skipped = 0;
for (const file of [...walk(path.join(root, "src"), [".ts", ".tsx"]), ...walk(path.join(root, "supabase/functions"), [".ts"])]) {
  const source = fs.readFileSync(file, "utf8");
  const re = /\.rpc\(\s*["'](\w+)["']/g;
  let match;
  while ((match = re.exec(source))) {
    const name = match[1];
    const rest = source.slice(match.index + match[0].length);
    let keys;
    if (/^\s*\)/.test(rest)) keys = [];
    else if (/^\s*,\s*\{/.test(rest)) {
      const open = match.index + match[0].length + rest.indexOf("{");
      const close = balancedEnd(source, open, "{", "}");
      keys = close === -1 ? null : objectKeys(source.slice(open, close + 1));
    } else keys = null; // arguments held in a variable; cannot be checked statically
    const where = `${path.relative(root, file)} -> ${name}`;
    sites += 1;
    const overloads = functions.get(name);
    if (!overloads) { fail(`${where}: no function with this name is defined in supabase/migrations`); continue; }
    if (keys === null) { skipped += 1; continue; }
    const matches = overloads.some((o) => keys.every((k) => o.names.includes(k)) && [...o.required].every((r) => keys.includes(r)));
    if (!matches) {
      const signatures = overloads.map((o) => `(${o.names.join(", ")}; required: ${[...o.required].join(", ") || "none"})`).join(" | ");
      fail(`${where}: arguments {${keys.join(", ")}} match no definition ${signatures}`);
    }
  }
}

console.log(`${sites} RPC call sites checked (${skipped} with non-literal arguments skipped), ${functions.size} functions defined.`);
if (failures) { console.error(`${failures} RPC argument contract failure(s).`); process.exit(1); }
console.log("PASS RPC call arguments match their database function definitions.");
