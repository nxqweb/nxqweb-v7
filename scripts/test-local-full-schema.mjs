#!/usr/bin/env node
// Reproducible local test: build a DISPOSABLE Postgres database from every file in
// supabase/migrations, then run focused contract checks against it.
//
// THIS IS NOT A REPRODUCTION OF STAGING. Supabase's platform pieces (pg_cron,
// supabase_vault, pg_net, auth, storage) are replaced by minimal stand-ins from
// scripts/sql/local-full-schema/stubs.sql, and migration 197 runs against PLACEHOLDER
// Vault values. See docs/LOCAL_FULL_SCHEMA_TEST.md for exact coverage and limits.
//
// Usage:   node scripts/test-local-full-schema.mjs
// Needs:   a running local PostgreSQL server (>= 14) with the contrib extensions
//          pgcrypto, uuid-ossp and pg_trgm, and a role that may create databases and roles.
// Connect: standard libpq variables (PGHOST, PGPORT, PGUSER, PGPASSWORD). If you run this
//          as root, set NXQ_LOCAL_PG_OS_USER=postgres to run psql through `su postgres`.
// Exit:    0 all checks passed | 1 a check or a migration failed | 2 environment problem.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { collectRpcCallSites } from "./lib/rpc-call-sites.mjs";

const root = process.cwd();
const osUser = process.env.NXQ_LOCAL_PG_OS_USER || "";
const dbName = `nxq_fullschema_${crypto.randomBytes(4).toString("hex")}`;
const requiredRoles = ["anon", "authenticated", "service_role", "authenticator"];
const contribExtensions = ["pgcrypto", "uuid-ossp", "pg_trgm"];
const stubbedExtensions = ["pg_cron", "supabase_vault", "pg_net"];

const results = [];
let setupComplete = false;
const createdRoles = [];
let databaseCreated = false;

function shellQuote(value) { return `'${String(value).replace(/'/g, "'\\''")}'`; }

function psql({ db = "postgres", sql, tuples = false, stopOnError = true, singleTransaction = false }) {
  const flags = ["-X", "-q", "-d", db, "-v", `ON_ERROR_STOP=${stopOnError ? 1 : 0}`];
  if (tuples) flags.push("-At", "-F", "|");
  if (singleTransaction) flags.push("-1");
  flags.push("-f", "-");
  let command = "psql"; let args = flags;
  if (osUser && process.getuid?.() === 0) {
    command = "su";
    args = [osUser, "-c", ["psql", ...flags].map(shellQuote).join(" ")];
  }
  const run = spawnSync(command, args, { input: sql, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  return { status: run.status, stdout: run.stdout || "", stderr: run.stderr || "", error: run.error };
}

function firstError(stderr) {
  return stderr.split("\n").find((line) => /error|fatal/i.test(line))?.trim() || stderr.trim().slice(0, 300);
}

function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
}

function environmentProblem(message) {
  console.error(`ENVIRONMENT PROBLEM: ${message}`);
  teardown();
  process.exit(2);
}

function teardown() {
  if (databaseCreated) {
    psql({ sql: `select pg_terminate_backend(pid) from pg_stat_activity where datname='${dbName}' and pid<>pg_backend_pid();\ndrop database if exists "${dbName}";` });
    databaseCreated = false;
  }
  for (const role of createdRoles.splice(0)) psql({ sql: `drop role if exists ${role};` });
}

process.on("SIGINT", () => { teardown(); process.exit(130); });

console.log("=== NXQ local full-schema test (disposable database; NOT a staging reproduction) ===");
console.log("Stand-ins: pg_cron, supabase_vault, pg_net, auth, storage. Migration 197 uses PLACEHOLDER Vault values.");

// ---- 0. Environment ----------------------------------------------------------------
const version = psql({ sql: "select current_setting('server_version_num')::int;", tuples: true });
if (version.status !== 0) environmentProblem(`cannot reach a local PostgreSQL server via psql (${firstError(version.stderr) || version.error?.message || "no output"}). Start one and set PG* variables or NXQ_LOCAL_PG_OS_USER.`);
const serverVersion = Number(version.stdout.trim());
if (serverVersion < 140000) environmentProblem(`PostgreSQL ${serverVersion} is older than 14.`);
const available = psql({ sql: `select name from pg_available_extensions where name in (${contribExtensions.map((n) => `'${n}'`).join(",")}) order by 1;`, tuples: true });
const missing = contribExtensions.filter((name) => !available.stdout.split("\n").includes(name));
if (missing.length) environmentProblem(`contrib extension(s) not installed on this server: ${missing.join(", ")}.`);

const existingRoles = psql({ sql: `select rolname from pg_roles where rolname in (${requiredRoles.map((r) => `'${r}'`).join(",")});`, tuples: true }).stdout.split("\n").filter(Boolean);
for (const role of requiredRoles) {
  if (existingRoles.includes(role)) continue;
  const created = psql({ sql: `create role ${role} nologin${role === "service_role" ? " bypassrls" : ""};` });
  if (created.status !== 0) environmentProblem(`cannot create role ${role}: ${firstError(created.stderr)}`);
  createdRoles.push(role);
}
const createdDb = psql({ sql: `create database "${dbName}";` });
if (createdDb.status !== 0) environmentProblem(`cannot create database: ${firstError(createdDb.stderr)}`);
databaseCreated = true;
console.log(`PostgreSQL ${serverVersion}; disposable database ${dbName}; roles created for this run: ${createdRoles.join(", ") || "none (already existed)"}.`);

const stubs = psql({ db: dbName, sql: fs.readFileSync(path.join(root, "scripts/sql/local-full-schema/stubs.sql"), "utf8"), singleTransaction: true });
if (stubs.status !== 0) environmentProblem(`stand-in SQL failed: ${firstError(stubs.stderr)}`);

// ---- 1. Apply every migration ---------------------------------------------------------
const migrationDir = path.join(root, "supabase/migrations");
const files = fs.readdirSync(migrationDir).filter((name) => name.endsWith(".sql")).sort();
const extensionRewrites = new Map(); let migrationFailures = 0;
const unknownExtensions = new Set();
for (const file of files) {
  let sql = fs.readFileSync(path.join(migrationDir, file), "utf8");
  for (const match of sql.matchAll(/create\s+extension\s+(?:if\s+not\s+exists\s+)?"?([a-z_\-]+)"?[^;]*;/gi)) {
    const name = match[1].toLowerCase();
    if (!contribExtensions.includes(name) && !stubbedExtensions.includes(name)) unknownExtensions.add(`${file}: ${name}`);
  }
  sql = sql.replace(/create\s+extension\s+(?:if\s+not\s+exists\s+)?"?(pg_cron|supabase_vault|pg_net)"?[^;]*;/gi, (_full, name) => {
    extensionRewrites.set(name, (extensionRewrites.get(name) || 0) + 1);
    return `select 1; -- ${name} stubbed by scripts/test-local-full-schema.mjs`;
  });
  if (file.startsWith("197_")) {
    // Migration 197 needs two Vault secrets that exist only in a configured Supabase project.
    sql = `select vault.create_secret('https://disposable-local-placeholder.supabase.co/functions/v1/provision-project-infrastructure','nxq_automation_edge_url','LOCAL PLACEHOLDER - not a staging value');
select vault.create_secret('local-disposable-placeholder-token','nxq_automation_worker_token','LOCAL PLACEHOLDER - not a staging value');
${sql}`;
  }
  const applied = psql({ db: dbName, sql, singleTransaction: true });
  if (applied.status !== 0) {
    migrationFailures += 1;
    record(`migration ${file} applies on a fresh database`, false, firstError(applied.stderr));
  }
}
if (unknownExtensions.size) environmentProblem(`unexpected extension(s) in migrations (extend the stand-ins): ${[...unknownExtensions].join("; ")}`);
console.log(`Applied ${files.length - migrationFailures}/${files.length} migrations. Extension statements replaced by no-ops: ${[...extensionRewrites].map(([n, c]) => `${n} x${c}`).join(", ")}.`);
console.log("Migration 197 ran against PLACEHOLDER Vault secrets (nxq_automation_edge_url, nxq_automation_worker_token); its route values are not staging's.");
if (migrationFailures === 0) record("all migrations apply to a fresh disposable database", true, `${files.length} files`);
setupComplete = migrationFailures === 0;

// ---- 2. Check: trigger functions referencing fields that do not exist -----------------
const triggerRefSql = (schemas) => `
with trg as (
  select t.tgname, t.tgrelid, t.tgrelid::regclass::text as rel, p.proname, p.prosrc
  from pg_trigger t join pg_proc p on p.oid = t.tgfoid join pg_class c on c.oid = t.tgrelid
  where not t.tgisinternal and c.relnamespace::regnamespace::text in (${schemas.map((s) => `'${s}'`).join(",")})
), refs as (
  select distinct trg.tgname, trg.rel, trg.proname, lower(m[1]) || '.' || m[2] as ref, trg.tgrelid, m[2] as col
  from trg, regexp_matches(regexp_replace(regexp_replace(trg.prosrc,'--[^\\n]*','','g'),'''[^'']*''','','g'),
       '\\m(new|old)\\.([a-z_][a-z0-9_]*)\\M(?!\\s*\\()', 'gi') as m
)
select r.tgname, r.rel, r.proname, r.ref from refs r
where not exists (select 1 from pg_attribute a where a.attrelid = r.tgrelid and a.attname = r.col and a.attnum > 0 and not a.attisdropped)
order by 2, 1, 4;`;

// A reference may be legitimate when it sits in its own statement that only executes for a
// different table (PL/pgSQL resolves fields when a statement is first run, not when the
// function is created). Each entry below must be justified; anything else is a failure.
const triggerRefAllowlist = new Map([
  ["enforce_and_record_commerce_usage|new.file_size",
    "inside `if tg_table_name = 'commerce_product_media'` in its own IF statement; never executed for commerce_products"],
]);

if (setupComplete) {
  const found = psql({ db: dbName, sql: triggerRefSql(["public"]), tuples: true });
  const hits = found.stdout.split("\n").filter(Boolean).map((line) => line.split("|"));
  const unexplained = hits.filter(([, , proc, ref]) => !triggerRefAllowlist.has(`${proc}|${ref}`));
  const count = psql({ db: dbName, sql: "select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid where not t.tgisinternal and c.relnamespace::regnamespace::text='public';", tuples: true }).stdout.trim();
  record("trigger functions reference only fields that exist on their table", found.status === 0 && unexplained.length === 0,
    found.status !== 0 ? firstError(found.stderr)
      : unexplained.length ? unexplained.map(([trg, rel, proc, ref]) => `${trg} on ${rel} (${proc}) uses ${ref}`).join("; ")
        : `${count} public triggers checked; ${hits.length} allow-listed`);

  // Detector self-test: reproduce the migration-132 defect shape and prove the check sees it.
  const selftest = psql({
    db: dbName, tuples: true, stopOnError: false,
    sql: `
create schema nxq_selftest;
create table nxq_selftest.parent(id int, client_id int);
create table nxq_selftest.child(id int, client_id int, location_id int);
create function nxq_selftest.shared_trigger() returns trigger language plpgsql as $f$
declare target int;
begin
  target := case when tg_table_name = 'parent' then coalesce(new.id, old.id)
                 else coalesce(new.location_id, old.location_id) end;
  return coalesce(new, old);
end $f$;
create trigger t_parent after insert or update on nxq_selftest.parent for each row execute function nxq_selftest.shared_trigger();
create trigger t_child after insert or update on nxq_selftest.child for each row execute function nxq_selftest.shared_trigger();
do $$ begin
  begin insert into nxq_selftest.parent values (1,1); raise notice 'SELFTEST_PARENT_INSERT=ok';
  exception when others then raise notice 'SELFTEST_PARENT_INSERT=%', sqlstate; end;
  begin insert into nxq_selftest.child values (1,1,1); raise notice 'SELFTEST_CHILD_INSERT=ok';
  exception when others then raise notice 'SELFTEST_CHILD_INSERT=%', sqlstate; end;
end $$;
${triggerRefSql(["nxq_selftest"])}
drop schema nxq_selftest cascade;`,
  });
  const flagged = selftest.stdout.split("\n").filter((line) => line.includes("nxq_selftest.parent"));
  const runtime = (selftest.stderr.match(/SELFTEST_PARENT_INSERT=(\w+)/) || [])[1];
  const control = (selftest.stderr.match(/SELFTEST_CHILD_INSERT=(\w+)/) || [])[1];
  record("detector self-test: a shared trigger reading a missing field is flagged",
    flagged.some((line) => line.includes("new.location_id")) && runtime === "42703" && control === "ok",
    `flagged=${flagged.length}, runtime insert on affected table=${runtime}, control table=${control}`);
}

// ---- 3. Check: RPC call arguments and EXECUTE privileges -------------------------------
if (setupComplete) {
  const catalog = psql({
    db: dbName, tuples: true,
    sql: `select coalesce(json_agg(json_build_object('name',p.proname,'names',coalesce(p.proargnames,'{}'::text[]),'modes',p.proargmodes,
      'n',p.pronargs,'nd',p.pronargdefaults,'anon',has_function_privilege('anon',p.oid,'execute'),
      'auth',has_function_privilege('authenticated',p.oid,'execute'),'svc',has_function_privilege('service_role',p.oid,'execute'))),'[]')
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f';`,
  });
  const byName = new Map();
  for (const fn of JSON.parse(catalog.stdout.trim() || "[]")) {
    const names = fn.modes ? fn.names.filter((_, i) => ["i", "b", "v"].includes(fn.modes[i])) : fn.names;
    const required = names.slice(0, fn.n - fn.nd);
    if (!byName.has(fn.name)) byName.set(fn.name, []);
    byName.get(fn.name).push({ names, required, anon: fn.anon, auth: fn.auth, svc: fn.svc });
  }
  const problems = []; let checked = 0; let skipped = 0; let privilegeChecked = 0;
  for (const site of collectRpcCallSites(root)) {
    checked += 1;
    const overloads = byName.get(site.name);
    const where = `${site.file} -> ${site.name}`;
    if (!overloads) { problems.push(`${where}: function does not exist in the database`); continue; }
    if (site.keys === null) { skipped += 1; continue; }
    const usable = overloads.filter((o) => site.keys.every((k) => o.names.includes(k)) && o.required.every((r) => site.keys.includes(r)));
    if (!usable.length) {
      problems.push(`${where}: arguments {${site.keys.join(", ")}} match none of ${overloads.map((o) => `(${o.names.join(",")})`).join(" | ")}`);
      continue;
    }
    let role = null;
    if (site.area === "edge") role = ["admin", "guardAdmin", "rpcClient"].includes(site.client) ? "svc" : site.client === "userClient" ? "auth" : null;
    else role = path.basename(site.file).startsWith("Public") ? "anon" : "auth";
    if (role) {
      privilegeChecked += 1;
      if (!usable.some((o) => o[role])) problems.push(`${where}: ${role === "svc" ? "service_role" : role === "auth" ? "authenticated" : "anon"} cannot EXECUTE it`);
    }
  }
  record("every RPC call site matches a database function's argument names and EXECUTE grant", problems.length === 0,
    problems.length ? problems.join("; ") : `${checked} call sites (${skipped} non-literal skipped, ${privilegeChecked} privilege-checked)`);
}

// ---- 3b. Check: pinned search_path + unqualified pgcrypto calls --------------------------
// On Supabase, pgcrypto lives in the "extensions" schema. A function with `set search_path = public`
// that calls digest()/hmac()/gen_random_bytes()/crypt()/gen_salt() without the `extensions.` prefix
// fails at RUNTIME there ("function digest(...) does not exist"), but passes locally because this
// harness installs pgcrypto into public. Migration 242 fixed one instance of this. The query reads
// the final catalog, so functions repaired by a later migration are not flagged.
const flaggedCryptoSql = `select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.prokind='f' and p.proconfig is not null
        and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%' and c not like '%extensions%')
        and p.prosrc ~* '(^|[^.[:alnum:]_])(digest|hmac|gen_random_bytes|crypt|gen_salt|pgp_sym_encrypt|pgp_sym_decrypt)[[:space:]]*\\(' order by 1;`;
const listFlaggedCrypto = () => psql({ db: dbName, tuples: true, sql: flaggedCryptoSql }).stdout.split("\n").map((l) => l.trim()).filter(Boolean);
if (setupComplete) {
  const flaggedCrypto = listFlaggedCrypto();
  // Baseline of functions already known to have this problem (reported, awaiting an approved repair
  // migration). Anything NOT in this list is a new regression and fails the check.
  const baselinePath = path.join(root, "scripts/sql/local-full-schema/known-unqualified-pgcrypto.txt");
  const knownCryptoBaseline = new Set(fs.existsSync(baselinePath)
    ? fs.readFileSync(baselinePath, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))
    : []);
  const fresh = flaggedCrypto.filter((name) => !knownCryptoBaseline.has(name));
  const stale = [...knownCryptoBaseline].filter((name) => !flaggedCrypto.includes(name));
  record("no NEW function pins search_path to public yet calls pgcrypto without the extensions. prefix", fresh.length === 0 && stale.length === 0,
    fresh.length || stale.length
      ? `new: ${fresh.join(", ") || "none"}; baseline entries no longer flagged (remove them): ${stale.join(", ") || "none"}`
      : `${flaggedCrypto.length} known function(s) still affected (see known-unqualified-pgcrypto.txt); no new ones`);
  if (flaggedCrypto.length) console.log(`NOTE  known runtime risk on Supabase (pgcrypto in the extensions schema): ${flaggedCrypto.join(", ")}`);
}

// ---- 4. Check: provision-storefront reservation-key regression ------------------------
const storefrontSource = fs.readFileSync(path.join(root, "supabase/functions/provision-storefront/index.ts"), "utf8");
const reserveCall = /rpc\(\s*["']nxq_reserve_netlify_build["']\s*,\s*\{([\s\S]*?)\}\s*\)/.exec(storefrontSource)?.[1] || "";
record("provision-storefront passes target_reservation_key (not target_idempotency_key) to nxq_reserve_netlify_build",
  reserveCall.includes("target_reservation_key") && !reserveCall.includes("target_idempotency_key"));

const fixtureSql = (body) => `
begin;
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
values ('22222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-000000000000','authenticated','authenticated',
        'fixture@synthetic.invalid','',now(),'{}','{"business_name":"Fixture Bakery","product_family_slug":"business","product_tier_key":"growth"}');
-- Status/billing changes are protected: perform them as the service role, as the platform would.
select set_config('request.jwt.claim.role','service_role',true);
update public.clients set status='active', billing_status='active' where auth_user_id='22222222-2222-2222-2222-222222222222';
insert into public.projects(client_id, project_name) select id, 'Fixture Site' from public.clients;
create temp table check_results(k text, v text);
grant all on check_results to public;
${body}
select k || '|' || v from check_results order by k;
rollback;`;

if (setupComplete) {
  const reservation = psql({
    db: dbName, tuples: true, stopOnError: false,
    sql: fixtureSql(`
select set_config('request.jwt.claim.role','service_role',true);
do $$ declare c uuid; p uuid; res jsonb; begin
  select id into c from public.clients; select id into p from public.projects;
  begin
    res := public.nxq_reserve_netlify_build(target_client_id=>c, target_project_id=>p, target_build_kind=>'preview',
      target_reservation_key=>'commerce-storefront:local-test:initial-preview', target_metadata=>'{}'::jsonb);
    insert into check_results values ('new_key', coalesce(res->>'ok','null'));
  exception when others then insert into check_results values ('new_key', 'error:' || sqlstate); end;
  begin
    perform public.nxq_reserve_netlify_build(target_client_id=>c, target_project_id=>p, target_build_kind=>'preview',
      target_idempotency_key=>'commerce-storefront:local-test:initial-preview', target_metadata=>'{}'::jsonb);
    insert into check_results values ('old_key', 'no-error');
  exception when others then insert into check_results values ('old_key', sqlstate); end;
end $$;`),
  });
  const out = Object.fromEntries(reservation.stdout.split("\n").filter((l) => l.includes("|")).map((l) => l.split("|")));
  record("nxq_reserve_netlify_build accepts target_reservation_key and rejects target_idempotency_key",
    out.new_key === "true" && out.old_key === "42883", out.new_key === undefined ? `fixture failed: ${firstError(reservation.stderr)}` : `new key -> ok=${out.new_key}; old key -> SQLSTATE ${out.old_key} (42883 = function does not exist)`);

  // Migration 256 regression: a client location insert must not raise 42703 from queue_location_seo_refresh().
  const location = psql({
    db: dbName, tuples: true, stopOnError: false,
    sql: fixtureSql(`
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',true);
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claims','{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',true);
set local role authenticated;
do $$ declare res jsonb; begin
  begin
    res := public.current_client_create_location('Main Street','Austin','TX',null,null,null,null,array[]::text[]);
    insert into check_results values ('create_location', coalesce(res->>'ok','null'));
  exception when others then insert into check_results values ('create_location', 'error:' || sqlstate || ':' || left(sqlerrm,80)); end;
end $$;
reset role;`),
  });
  const locOut = Object.fromEntries(location.stdout.split("\n").filter((l) => l.includes("|")).map((l) => l.split("|")));
  record("a client can create a location (no 42703 from queue_location_seo_refresh, migration 256)", locOut.create_location === "true", `result=${locOut.create_location ?? `fixture failed: ${firstError(location.stderr)}`}`);
}

// ---- 5. Draft migrations (docs/drafts/migrations) ---------------------------------------
// Drafts are NOT real migrations. Each is applied after all real migrations, then its sidecar test
// (<name>.test.sql, which must select DRAFT_TEST_OK) runs inside a rolled-back transaction.
const draftDir = path.join(root, "docs/drafts/migrations");
if (setupComplete && fs.existsSync(draftDir)) {
  const drafts = fs.readdirSync(draftDir).filter((n) => n.endsWith(".sql") && !n.endsWith(".test.sql")).sort();
  let allApplied = true;
  for (const name of drafts) {
    const applied = psql({ db: dbName, sql: fs.readFileSync(path.join(draftDir, name), "utf8"), singleTransaction: true, stopOnError: true });
    record(`draft ${name} applies after all real migrations`, applied.status === 0, firstError(applied.stderr));
    if (applied.status !== 0) { allApplied = false; continue; }
  }
  if (allApplied && drafts.length) {
    // Run the sidecar tests only after every draft is applied, so drafts that depend on each other work.
    for (const name of drafts) {
      const testPath = path.join(draftDir, name.replace(/\.sql$/, ".test.sql"));
      if (!fs.existsSync(testPath)) { record(`draft ${name} has a sidecar test`, false, "missing"); continue; }
      const t = psql({ db: dbName, tuples: true, sql: fs.readFileSync(testPath, "utf8") });
      record(`draft ${name} passes its sidecar test`, t.status === 0 && t.stdout.includes("DRAFT_TEST_OK"), t.status === 0 ? t.stdout.trim().slice(-200) : firstError(t.stderr));
    }
    if (drafts.some((n) => n.includes("repair_pgcrypto_search_path"))) {
      const left = listFlaggedCrypto();
      record("after the drafted repair no function pins search_path to public and calls pgcrypto unqualified", left.length === 0, left.join(", "));
    }
  }
}

// ---- Teardown and summary ----------------------------------------------------------------
const rolesCreatedThisRun = [...createdRoles];
teardown();
const stillThere = psql({ sql: `select count(*) from pg_database where datname='${dbName}';`, tuples: true }).stdout.trim();
console.log(`Teardown: disposable database removed (${stillThere === "0" ? "confirmed" : "STILL PRESENT"}); roles dropped: ${rolesCreatedThisRun.length ? rolesCreatedThisRun.join(", ") : "none (none were created by this run)"}.`);
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} local full-schema checks passed.`);
console.log("Reminder: this proves source/migration consistency on a stand-in platform. It does not prove staging or production behavior.");
process.exit(failed.length ? 1 : 0);
