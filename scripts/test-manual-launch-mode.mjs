// Offline test: manual launch mode for the three key-dependent readiness checks (database draft 05; owner decision 2026-11-23, Option B), drafted 2026-11-24.
import fs from "node:fs";
let failures = 0;
function check(name, ok, detail = "") { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); } }
const sql = fs.readFileSync("docs/drafts/migrations/05_manual_launch_mode.sql", "utf8");
const body = sql.replace(/--.*$/gm, "");
const three = ["notification_pipeline_ready", "change_classifier_ready", "business_build_plan_ai_ready"];

check("the draft names exactly the three key-dependent checks and no other check", [...body.matchAll(/'([a-z_]+_(?:ready|passed|signoff|runs))'/g)].map((m) => m[1]).every((k) => three.includes(k) || k === "owner_launch_signoff") && three.every((k) => body.includes(`'${k}'`)));
check("the sign-off, the scanner, the ten runs and the isolation checks are not waived by it", !/file_security_pipeline_ready|ten_clean_runs|rls_isolation_passed|storage_isolation_passed/.test(body) && /where check_key = 'owner_launch_signoff' and status = 'ready'/.test(body));
check("the waiver reason lives in its own columns (the evaluators rewrite status and evidence on every run), and the change is additive", /add column if not exists waived_reason text/.test(body) && /add column if not exists waived_at timestamptz/.test(body) && !/drop |alter column|delete from|truncate/i.test(body));
check("the switch is owner-only, sign-off-locked, logged, reversible, and withdraws an existing sign-off when turned off", /not exists \(select 1 from public\.owner_users ou where ou\.auth_user_id = auth\.uid\(\)\)/.test(body) && /pg_advisory_xact_lock\(hashtextextended\('nxq-owner-launch-readiness-signoff', 0\)\)/.test(body) && /manual_launch_mode_set/.test(body) && /manual_launch_mode_turned_off/.test(body) && /revoke all on function public\.owner_set_manual_launch_mode\(boolean\) from public, anon;/.test(body) && /grant execute on function public\.owner_set_manual_launch_mode\(boolean\) to authenticated;/.test(body));
const test = fs.readFileSync("docs/drafts/migrations/05_manual_launch_mode.test.sql", "utf8");
check("the database test covers: only three waived, sign-off passes with them waived, off withdraws the sign-off and blocks again, on again, logging, and an evaluator rewrite not undoing it", ["no other check may be waived", "sign-off must succeed with the three waived", "off must restore three checks and withdraw the sign-off", "the block must name the three again", "both switches must be logged", "an evaluator run must not undo the waiver"].every((s) => test.includes(s)));
const page = fs.readFileSync("src/pages/OwnerLaunchReadiness.tsx", "utf8");
check("the owner page says plainly which checks are waived and why (only when the check is not required and has a reason)", page.includes("waived_reason?: string | null;") && page.includes("if (!check.required && check.waived_reason) return `Waived for launch: ${check.waived_reason}`;"));
const callers = fs.readdirSync("src", { recursive: true }).filter((f) => /\.tsx?$/.test(f)).filter((f) => /owner_set_manual_launch_mode/.test(fs.readFileSync(`src/${f}`, "utf8")));
check("no page calls the draft-only switch (it is used from the database editor only, after the owner approves)", callers.length === 0, callers.join(","));
check("the migration is still only a draft (not in supabase/migrations)", !fs.readdirSync("supabase/migrations").some((f) => /manual_launch_mode/.test(f)));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll manual launch mode checks passed (offline).");
process.exit(failures ? 1 : 0);
