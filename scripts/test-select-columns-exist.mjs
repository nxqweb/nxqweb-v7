// Static check: every simple `.from("table").select("col, col")` in the app and Edge functions names columns
// that exist in the migrations (create table + alter table add column, plus views as opaque). A missing
// column makes PostgREST reject the whole request at runtime (this is how the privacy export failed).
// Embedded resources (`other(...)`), `*`, aliases and casts are skipped, so a PASS is necessary, not sufficient.
import fs from "node:fs";
import path from "node:path";

const migrationsDir = "supabase/migrations";
const sql = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort().map((f) => fs.readFileSync(path.join(migrationsDir, f), "utf8")).join("\n");
const lower = sql.toLowerCase();

const columns = new Map(); // table -> Set
const views = new Set();
const add = (table, column) => { if (!columns.has(table)) columns.set(table, new Set()); columns.get(table).add(column); };

// create table blocks
const createRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+)"?\s*\(/g;
let m;
while ((m = createRe.exec(lower))) {
  const table = m[1];
  let depth = 1, i = createRe.lastIndex, start = i;
  while (i < lower.length && depth > 0) { const ch = lower[i]; if (ch === "(") depth++; else if (ch === ")") depth--; i++; }
  const body = lower.slice(start, i - 1);
  // split on top-level commas
  let d = 0, cur = "", parts = [];
  for (const ch of body) { if (ch === "(") d++; if (ch === ")") d--; if (ch === "," && d === 0) { parts.push(cur); cur = ""; } else cur += ch; }
  parts.push(cur);
  for (const part of parts) {
    const t = part.trim().replace(/^--.*$/gm, "").trim();
    const col = /^"?([a-z_][a-z0-9_]*)"?\s+/.exec(t);
    if (!col) continue;
    if (["constraint", "primary", "unique", "foreign", "check", "exclude", "like"].includes(col[1])) continue;
    add(table, col[1]);
  }
}
// alter table add column (possibly several per statement)
const alterRe = /alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:public\.)?"?([a-z0-9_]+)"?([^;]*);/g;
while ((m = alterRe.exec(lower))) {
  const table = m[1];
  for (const a of m[2].matchAll(/add\s+column\s+(?:if\s+not\s+exists\s+)?"?([a-z_][a-z0-9_]*)"?/g)) add(table, a[1]);
  for (const r of m[2].matchAll(/rename\s+column\s+"?([a-z_][a-z0-9_]*)"?\s+to\s+"?([a-z_][a-z0-9_]*)"?/g)) add(table, r[2]);
}
for (const v of lower.matchAll(/create\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+)"?/g)) views.add(v[1]);

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const files = [...walk("src"), ...walk("supabase/functions")].filter((f) => /\.(ts|tsx)$/.test(f));

let checked = 0, problems = [];
for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  for (const q of text.matchAll(/\.from\(\s*["'`]([a-z0-9_]+)["'`]\s*\)\s*\.select\(\s*["'`]([^"'`]*)["'`]/g)) {
    const table = q[1], list = q[2];
    if (views.has(table) || list.includes("(") || list.trim() === "*" ) continue;
    if (!columns.has(table)) { problems.push(`${file}: table "${table}" not found in migrations`); continue; }
    for (let col of list.split(",").map((c) => c.trim()).filter(Boolean)) {
      if (col.includes(":") || col.includes("->") || col.includes("::") || col === "*") continue;
      checked++;
      if (!columns.get(table).has(col)) problems.push(`${file}: ${table}.${col} does not exist`);
    }
  }
}
// shallow insert/update/upsert object literals: .from("t").insert({ a: 1, b, c: x })
let writes = 0;
for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  for (const q of text.matchAll(/\.from\(\s*["'`]([a-z0-9_]+)["'`]\s*\)\s*\.(insert|update|upsert)\(\s*\{([^{}]*)\}/g)) {
    const table = q[1];
    if (views.has(table) || !columns.has(table)) continue;
    const keys = [...q[3].matchAll(/(?:^|,)\s*([a-z_][a-z0-9_]*)\s*(?=:|,|$)/gi)].map((k) => k[1]).filter((k) => !/^(true|false|null)$/.test(k));
    for (const key of keys) {
      writes++;
      if (!columns.get(table).has(key)) problems.push(`${file}: ${q[2]} writes ${table}.${key}, which does not exist`);
    }
  }
}
console.log(`Checked ${writes} written columns.`);
for (const p of problems) console.log(`FAIL  ${p}`);
console.log(`\nChecked ${checked} selected columns across ${files.length} files; ${problems.length} problem(s).`);
process.exit(problems.length ? 1 : 0);
