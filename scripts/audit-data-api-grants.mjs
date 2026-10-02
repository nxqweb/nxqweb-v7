// Static, local-only audit of Supabase Data API grants for every public table
// created by supabase/migrations. Models a fresh project / db reset where new
// public tables receive NO automatic anon/authenticated/service_role grants.
// This is a source-level analysis; it is NOT proof of live database access.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const migrationsDir = path.join(root, "supabase/migrations");
const ROLES = ["anon", "authenticated", "service_role"];
const ALL_PRIVS = ["select", "insert", "update", "delete", "truncate", "references", "trigger"];

function stripNoise(sql) {
  // Remove comments, then blank out dollar-quoted bodies and string literals so
  // statement splitting on ';' is safe. DO-block bodies are scanned separately.
  let out = sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const bodies = [];
  out = out.replace(/\$([A-Za-z_]*)\$([\s\S]*?)\$\1\$/g, (m, tag, body) => {
    bodies.push(body);
    return `$$BODY${bodies.length - 1}$$`;
  });
  return { text: out, bodies };
}

const norm = (name) => name.replace(/"/g, "").replace(/^public\./i, "").trim().toLowerCase();
const splitList = (s) => s.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);

function parsePrivs(raw) {
  const p = raw.trim().toLowerCase();
  if (p.startsWith("all")) return [...ALL_PRIVS];
  return p.split(",").map((x) => x.trim().replace(/\(.*\)/, "")).filter((x) => ALL_PRIVS.includes(x));
}

function parseRoles(raw) {
  return splitList(raw.replace(/\bgroup\b/gi, "")).map((r) => r.replace(/"/g, ""));
}

const tables = new Map(); // name -> state
const events = [];
const unresolved = [];

function ensure(name, mig) {
  if (!tables.has(name)) {
    tables.set(name, {
      name, created: mig, dropped: null, rls: false, forceRls: false,
      grants: Object.fromEntries(ROLES.map((r) => [r, new Set()])), explicitService: false, revokedClientAccess: false,
      policies: new Map(), grantMigrations: new Set(),
    });
  }
  return tables.get(name);
}

const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
for (const file of files) {
  const raw = fs.readFileSync(path.join(migrationsDir, file), "utf8");
  const { text, bodies } = stripNoise(raw);
  const mig = file.slice(0, 3);
  // Statements outside bodies, plus statements inside DO blocks / functions.
  const chunks = [text, ...bodies.filter((b) => /\b(grant|revoke|create\s+table)\b/i.test(b))];
  for (const chunk of chunks) {
    for (const stmtRaw of chunk.split(";")) {
      const stmt = stmtRaw.replace(/\s+/g, " ").trim();
      if (!stmt) continue;
      let m;
      if ((m = stmt.match(/^create (?:unlogged )?table (?:if not exists )?((?:public\.)?"?[\w]+"?)/i))) {
        const isNew = !tables.has(norm(m[1]));
        const t = ensure(norm(m[1]), mig); t.dropped = null;
        // Migration 195 set ALTER DEFAULT PRIVILEGES ... TO service_role for the
        // migration role, so later tables inherit it without an explicit grant.
        if (isNew && Number(mig) > 195) { for (const p of ALL_PRIVS) t.grants.service_role.add(p); t.serviceViaDefault = true; }
        continue;
      }
      if ((m = stmt.match(/^drop table (?:if exists )?([^;]+?)(?: cascade| restrict)?$/i))) {
        for (const n of splitList(m[1])) { const t = tables.get(norm(n)); if (t) t.dropped = mig; }
        continue;
      }
      if ((m = stmt.match(/^alter table (?:if exists )?(?:only )?((?:public\.)?"?[\w]+"?) rename to "?(\w+)"?$/i))) {
        const old = norm(m[1]); const t = tables.get(old);
        if (t) { tables.delete(old); t.name = m[2].toLowerCase(); tables.set(t.name, t); events.push(`${mig}: rename ${old} -> ${t.name}`); }
        continue;
      }
      if ((m = stmt.match(/^alter table (?:if exists )?(?:only )?((?:public\.)?"?[\w]+"?) (enable|disable|force|no force) row level security/i))) {
        const t = tables.get(norm(m[1])); if (!t) continue;
        const a = m[2].toLowerCase();
        if (a === "enable") t.rls = true; if (a === "disable") t.rls = false;
        if (a === "force") t.forceRls = true; if (a === "no force") t.forceRls = false;
        continue;
      }
      if ((m = stmt.match(/^create policy ("[^"]+"|\w+) on ((?:public\.)?"?[\w]+"?)(.*)$/i))) {
        const t = tables.get(norm(m[2])); if (!t) continue;
        const rest = m[3];
        const cmd = (rest.match(/ for (all|select|insert|update|delete)\b/i) || [, "all"])[1].toLowerCase();
        const to = (rest.match(/ to ([\w", ]+?)(?: using| with check|$)/i) || [, "public"])[1];
        t.policies.set(m[1].replace(/"/g, ""), { cmd, roles: parseRoles(to), mig });
        continue;
      }
      if ((m = stmt.match(/^drop policy (?:if exists )?("[^"]+"|\w+) on ((?:public\.)?"?[\w]+"?)/i))) {
        const t = tables.get(norm(m[2])); if (t) t.policies.delete(m[1].replace(/"/g, ""));
        continue;
      }
      if ((m = stmt.match(/^(grant|revoke) (.+?) on (?:table )?(.+?) (to|from) (.+?)(?: with grant option| cascade| restrict)?$/i))) {
        const verb = m[1].toLowerCase();
        if (/^(execute|usage|all on sequences)/i.test(m[2]) || /^(function|sequence|schema|all functions|all sequences|type|domain)/i.test(m[3])) continue;
        const privs = parsePrivs(m[2]);
        const roles = parseRoles(m[5]).map((r) => (r === "public" ? "PUBLIC" : r));
        if (/^all tables in schema public$/i.test(m[3])) {
          for (const t of tables.values()) for (const r of roles) {
            if (!t.grants[r]) continue;
            for (const p of privs) verb === "grant" ? t.grants[r].add(p) : t.grants[r].delete(p);
          }
          events.push(`${mig}: ${verb} on ALL TABLES in schema public -> ${roles.join(",")}`);
          continue;
        }
        for (const n of splitList(m[3])) {
          const t = tables.get(norm(n));
          if (!t) continue;
          for (const r of roles) {
            if (r === "PUBLIC") { for (const rr of ["anon", "authenticated"]) for (const p of privs) verb === "grant" ? t.grants[rr].add(p) : t.grants[rr].delete(p); continue; }
            if (!t.grants[r]) continue;
            for (const p of privs) verb === "grant" ? t.grants[r].add(p) : t.grants[r].delete(p);
          }
          if (verb === "revoke" && roles.some((x) => ["authenticated", "PUBLIC"].includes(x))) t.revokedClientAccess = true;
          if (verb === "grant") { t.grantMigrations.add(mig); if (roles.includes("service_role")) t.explicitService = true; }
        }
        continue;
      }
      if (/\b(grant|revoke)\b.*\b(on table|on all tables)\b/i.test(stmt) && /format\(|execute|%I|%s/i.test(stmt)) unresolved.push(`${mig}: dynamic grant/revoke ${stmt.slice(0, 120)}`);
      if ((m = stmt.match(/^alter default privileges/i))) events.push(`${mig}: ${stmt.slice(0, 140)}`);
    }
  }
}

const out = [...tables.values()].filter((t) => !t.dropped).sort((a, b) => a.name.localeCompare(b.name));

function scanSources(dir, exts) {
  const found = new Map(); // table -> Map(file -> Set(ops))
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!exts.some((x) => e.name.endsWith(x))) continue;
      const src = fs.readFileSync(p, "utf8");
      const re = /\.from\(\s*["'`](\w+)["'`]\s*\)([\s\S]{0,400}?)(?=\n\s*\n|;|\.from\()/g;
      let m;
      while ((m = re.exec(src))) {
        const ops = [...m[2].matchAll(/\.(select|insert|update|delete|upsert)\(/g)].map((x) => x[1]);
        if (!found.has(m[1])) found.set(m[1], new Map());
        const f = found.get(m[1]);
        const key = path.relative(root, p);
        if (!f.has(key)) f.set(key, new Set());
        for (const o of ops.length ? ops : ["?"]) f.get(key).add(o);
      }
    }
  };
  walk(path.join(root, dir));
  return found;
}
const feUse = scanSources("src", [".ts", ".tsx"]);
const edgeUse = scanSources("supabase/functions", [".ts"]);

const needPriv = (op) => (op === "upsert" ? ["insert", "update"] : ["?"].includes(op) ? [] : [op]);
const rows = out.map((t) => {
  const fe = feUse.get(t.name);
  const feOps = fe ? [...new Set([...fe.values()].flatMap((s) => [...s]))].sort() : [];
  const feFiles = fe ? [...fe.keys()].map((f) => path.basename(f)).sort() : [];
  const edgeFns = edgeUse.get(t.name) ? [...edgeUse.get(t.name).keys()].map((f) => f.split("/")[2]).sort() : [];
  const auth = [...t.grants.authenticated].sort();
  const anon = [...t.grants.anon].sort();
  const policies = [...t.policies.entries()].map(([name, p]) => ({ name, cmd: p.cmd, roles: p.roles }));
  const policyRoles = new Set(policies.flatMap((p) => p.roles));
  const flags = [];
  const missing = [...new Set(feOps.flatMap(needPriv))].filter((p) => !t.grants.authenticated.has(p) && !t.grants.anon.has(p));
  if (missing.length) flags.push(`PROVEN_GAP_FRONTEND(missing ${missing.join("/")})`);
  if (!missing.length && !auth.length && !anon.length && (policyRoles.has("authenticated") || policyRoles.has("anon") || policyRoles.has("public"))) flags.push(t.revokedClientAccess ? "DELIBERATELY_REVOKED_VESTIGIAL_POLICY" : "LATENT_POLICY_WITHOUT_GRANT");
  if (anon.length && !(policyRoles.has("anon") || policyRoles.has("public"))) flags.push("ANON_GRANT_WITHOUT_ANON_POLICY");
  if (t.serviceViaDefault && !t.explicitService) flags.push("SERVICE_ROLE_VIA_DEFAULT_PRIVILEGES_ONLY");
  if (!t.rls) flags.push("NO_RLS");
  return { table: t.name, created: t.created, rls: t.rls, anon, authenticated: auth, service_role: [...t.grants.service_role].sort(), policies, feOps, feFiles, edgeFns, flags };
});

const emit = async (text) => { await new Promise((resolve) => process.stdout.write(`${text}\n`, resolve)); process.exit(0); };
if (process.argv.includes("--json")) await emit(JSON.stringify({ tables: rows, events, unresolved }, null, 1));
if (process.argv.includes("--markdown")) {
  const lines = ["| Table | Mig | RLS | anon | authenticated | service_role | Frontend (ops) | Edge fns | Flags |", "|---|---|---|---|---|---|---|---|---|"];
  const short = (a) => (a.length ? a.join(",") : "-");
  for (const r of rows) {
    const svc = r.service_role.length === ALL_PRIVS.length ? "all" : short(r.service_role);
    lines.push(`| ${r.table} | ${r.created} | ${r.rls ? "yes" : "NO"} | ${short(r.anon)} | ${short(r.authenticated)} | ${svc} | ${r.feOps.length ? r.feOps.join(",") : "-"} | ${r.edgeFns.length ? r.edgeFns.length + " fn" : "-"} | ${r.flags.join("; ") || "ok"} |`);
  }
  await emit(lines.join("\n"));
}
const count = (f) => rows.filter((r) => r.flags.some((x) => x.startsWith(f))).length;
console.log(`Tables defined in public after all migrations: ${rows.length}`);
console.log(`RLS enabled: ${rows.filter((r) => r.rls).length}/${rows.length}`);
console.log(`Explicit anon grants: ${rows.filter((r) => r.anon.length).length}; authenticated: ${rows.filter((r) => r.authenticated.length).length}; service_role: ${rows.filter((r) => r.service_role.length).length}`);
for (const e of events) console.log("event:", e);
for (const u of unresolved) console.log("UNRESOLVED:", u);
for (const flag of ["PROVEN_GAP_FRONTEND", "LATENT_POLICY_WITHOUT_GRANT", "DELIBERATELY_REVOKED_VESTIGIAL_POLICY", "ANON_GRANT_WITHOUT_ANON_POLICY", "SERVICE_ROLE_VIA_DEFAULT_PRIVILEGES_ONLY", "NO_RLS"]) {
  const hit = rows.filter((r) => r.flags.some((x) => x.startsWith(flag)));
  console.log(`${flag}: ${hit.length}${hit.length ? " -> " + hit.map((r) => r.table).join(", ") : ""}`);
}
console.log("NOTE: static source analysis only; not proof of live database grants or access.");
const proven = count("PROVEN_GAP_FRONTEND") + count("NO_RLS");
if (proven && !process.argv.includes("--report")) { console.error(`FAIL: ${proven} proven source-level gap(s). Re-run with --report to inspect without failing.`); process.exit(1); }
