// Promotes the pre-launch waitlist draft into the real tree. Run from the repo root:   node docs/drafts/waitlist/promote.mjs [--dry-run] [--root <dir>]
// WHAT IT DOES (all local file edits, nothing is applied, deployed or pushed): moves the draft files to their real homes, adds the waitlist migration as the next number in
// supabase/migrations/ with its regression test, and registers the function and pages everywhere the repo checks (manifest, config.toml, stage-readiness markers, routes,
// owner link, smoke routes, store tests). Moving the migration into supabase/migrations/ is a stop-and-ask gate (CLAUDE.md): run this only after the owner says
// "promote the waitlist". Applying the migration and deploying the function are separate approvals (docs/drafts/waitlist/README.md).
// It refuses to run if a target file already exists or an anchor line has moved, and it changes nothing in that case.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const rootArg = args.indexOf("--root");
const root = path.resolve(rootArg >= 0 ? args[rootArg + 1] : process.cwd());
const here = path.dirname(fileURLToPath(import.meta.url));
const draftDir = path.join(root, "docs/drafts/waitlist");
const sqlDraftDir = path.join(root, "docs/drafts/migrations");
if (path.resolve(here) !== path.resolve(draftDir)) { console.error(`This script must be run from the draft folder inside the target root (${draftDir}).`); process.exit(2); }

const problems = [];
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(root, rel));

// ---- the migration number: one past the highest one that exists ------------------------------------------------------------------
const numbers = fs.readdirSync(path.join(root, "supabase/migrations")).map((n) => /^(\d+)_/.exec(n)?.[1]).filter(Boolean).map(Number);
const next = String(Math.max(...numbers) + 1).padStart(3, "0");
const migrationName = `${next}_prelaunch_waitlist`;

const moves = [
  ["docs/drafts/waitlist/waitlist-input.mjs", "supabase/functions/_shared/waitlist-input.mjs"],
  ["docs/drafts/waitlist/join-waitlist.index.ts", "supabase/functions/join-waitlist/index.ts"],
  ["docs/drafts/waitlist/waitlist.ts", "src/lib/waitlist.ts"],
  ["docs/drafts/waitlist/waitlistSupabaseGateway.ts", "src/lib/waitlistSupabaseGateway.ts"],
  ["docs/drafts/waitlist/waitlistConfig.ts", "src/lib/waitlistConfig.ts"],
  ["docs/drafts/waitlist/PublicWaitlist.tsx", "src/pages/PublicWaitlist.tsx"],
  ["docs/drafts/waitlist/OwnerWaitlist.tsx", "src/pages/OwnerWaitlist.tsx"],
  ["docs/drafts/waitlist/test-waitlist.mjs", "scripts/test-waitlist.mjs"],
  ["docs/drafts/migrations/03_prelaunch_waitlist.sql", `supabase/migrations/${migrationName}.sql`],
  ["docs/drafts/migrations/03_prelaunch_waitlist.test.sql", `scripts/sql/local-full-schema/regression/${migrationName}.test.sql`],
];
for (const [from, to] of moves) {
  if (!exists(from)) problems.push(`missing draft file: ${from}`);
  if (exists(to)) problems.push(`target already exists: ${to}`);
}

// ---- the edits: each is "after this exact line, add that text" ---------------------------------------------------------------------
const edits = [
  ["src/App.tsx", 'const PublicExamples = named(() => import("./pages/PublicExamples"), "PublicExamples");', '\nconst PublicWaitlist = named(() => import("./pages/PublicWaitlist"), "PublicWaitlist");'],
  ["src/App.tsx", 'const OwnerStoreLook = named(() => import("./pages/OwnerStoreLook"), "OwnerStoreLook");', '\nconst OwnerWaitlist = named(() => import("./pages/OwnerWaitlist"), "OwnerWaitlist");'],
  ["src/App.tsx", '  if (path === "/owner/store-look") return <OwnerProtectedRoute><OwnerStoreLook /></OwnerProtectedRoute>;', '\n  if (path === "/owner/waitlist") return <OwnerProtectedRoute><OwnerWaitlist /></OwnerProtectedRoute>;'],
  ["src/App.tsx", '  if (path === "/examples") return <PublicExamples />;', '\n  if (path === "/waitlist") return <PublicWaitlist />;'],
  ["src/pages/OwnerPortal.tsx", '                <a className="icon-btn" href="/owner/store-look">Store look</a>', '\n                <a className="icon-btn" href="/owner/waitlist">Waiting list</a>'],
  ["scripts/edge-function-manifest.mjs", '  entry("ingest-stripe-webhook", false, "stripe-signature"),', '\n  entry("join-waitlist", false, "public-waitlist-origin"),'],
  ["supabase/config.toml", "[functions.answer-site-question]\nverify_jwt = false", "\n[functions.join-waitlist]\nverify_jwt = false"],
  ["scripts/check-runtime-stage-readiness.mjs", '  "public-form-key": ["business_lead_forms", \'.eq("form_key"\'],', '\n  "public-waitlist-origin": ["handleWaitlist", "nxq_waitlist_join", "nxq_reserve_ingress_capacity"],'],
  ["scripts/smoke-built-routes.mjs", '  "/", "/plans",', ' "/waitlist",'],
  ["scripts/run-store-tests.mjs", '  "test-shopper-account",', ' "test-waitlist",'],
];
const plannedText = new Map();
for (const [file, anchor, addition] of edits) {
  if (!exists(file)) { problems.push(`missing file to edit: ${file}`); continue; }
  const text = plannedText.get(file) ?? read(file);
  const count = text.split(anchor).length - 1;
  if (count !== 1) { problems.push(`${file}: the anchor line was found ${count} times (need exactly 1): ${anchor.trim().slice(0, 80)}`); continue; }
  plannedText.set(file, text.replace(anchor, anchor + addition));
}

// ---- the drafts README: say it was promoted ----------------------------------------------------------------------------------
const readmePath = "docs/drafts/migrations/README.md";
let readme = exists(readmePath) ? read(readmePath) : "";
const readmeRow = /^\| `03_prelaunch_waitlist\.sql`.*\n/m;
if (!readmeRow.test(readme)) problems.push(`${readmePath}: the 03_prelaunch_waitlist row was not found`);

if (problems.length) {
  console.error("Nothing was changed. Fix these first:\n - " + problems.join("\n - "));
  process.exit(1);
}

console.log(`${dryRun ? "[dry run] " : ""}Promoting the waitlist as migration ${migrationName} (nothing is applied or deployed).`);
for (const [from, to] of moves) {
  console.log(`  move  ${from}  ->  ${to}`);
  if (dryRun) continue;
  fs.mkdirSync(path.dirname(path.join(root, to)), { recursive: true });
  fs.copyFileSync(path.join(root, from), path.join(root, to));
  fs.rmSync(path.join(root, from));
}
for (const [file, text] of plannedText) { console.log(`  edit  ${file}`); if (!dryRun) fs.writeFileSync(path.join(root, file), text); }
if (!dryRun) {
  readme = readme.replace(readmeRow, "");
  readme += `\nThe pre-launch waitlist draft (\`03_prelaunch_waitlist\`) was promoted to real migration \`${migrationName}\` by \`docs/drafts/waitlist/promote.mjs\` (owner approved in chat). Its test now lives in \`scripts/sql/local-full-schema/regression/\`. NOT applied to staging; applying it and deploying \`join-waitlist\` are separate approvals.\n`;
  fs.writeFileSync(path.join(root, readmePath), readme);
  // The package's own README stays behind as the record of how to switch it on; everything else has moved.
  console.log("  keep  docs/drafts/waitlist/README.md (the switch-on steps)");
}
console.log(dryRun ? "\nDry run only: no file was changed." : `\nDone. Next: run npm run test:ci-parity and the local Postgres harness, then commit. Applying migration ${next} needs the owner's typed phrase and the Approve click.`);
