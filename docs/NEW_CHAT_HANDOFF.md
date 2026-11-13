# NXQX-Web: new-chat handoff (written 2026-11-12, upload this file to the new chat)

**First message to paste into the new chat:** "Read CLAUDE.md and docs/NEW_CHAT_HANDOFF.md in the nxqweb-v7 repo, check git against origin, ask me whether Netlify builds are ON or OFF before any push, then continue with the first of the next three safe tasks."

## Do this first (every session)
1. `git fetch`, then compare `git rev-parse HEAD` with `git ls-remote origin refs/heads/safe/checkpoint-autonomy-wave35-sales`. Branch: `safe/checkpoint-autonomy-wave35-sales`. Never work on `main`. Never trust a SHA written in a document.
2. Read `CLAUDE.md` (standing rules), then the "HANDOFF 2026-11-12" block at the top of `docs/NXQ_RUNTIME_HANDOFF.md`, `docs/PATH_TO_LAUNCH.md` (one-page plan to Jun 16, 2027) and `docs/EXPIRING_TOKENS.md` (token names and expiry dates). The "Canonical launch checklist" is in `docs/NXQ_RUNTIME_HANDOFF.md`.
3. Ask the owner whether **Netlify builds are ON or OFF** before ANY push. The main staging site (`nxqweb-v9-staging`) shows "Builds are stopped": never click "Activate builds". Production deploys cost 15 credits each, previews are not billed. (The disposable QA sites are separate Netlify projects that the pipeline creates itself.)
4. Before every push run `npm run test:ci-parity` (74 commands, about 3 minutes; check the exit code and the "All 74 CI commands passed" line). A real Postgres is in the sandbox: `pg_ctlcluster 16 main start`, then `NXQ_LOCAL_PG_OS_USER=postgres node scripts/test-local-full-schema.mjs` (50/50). Fresh container with an empty `node_modules`: run `npm ci` first.

## Where things stand (2026-11-12)
- **Clean approve QA runs: 6 of 10** (verified in the database: `select public.count_strict_clean_business_runs();` returned 6). Only APPROVE runs count; a failed run does not reset the count. 4 more are needed.
- **Launch readiness: 20/26 (77%)** after the evidence refresh. The 6 open checks: ten clean runs, the owner launch signoff (last), two AI checks (need the AI key), the notification dispatcher (needs an email provider), the file scanner (needs a scanner provider). Live Stripe is NOT required in the current launch mode.
- **Netlify credits: 42.8 of 300**, they expire 2026-11-22 and reset to 300 on 2026-11-23. A clean QA run costs **30 or 45** credits (1 or 2 production deploys at site creation plus 1 for the final commit). The promotion double-deploy is fixed and proven on two runs.
- Staging database: migrations through **287 applied**, nothing pending. 45 Edge functions deployed. The promotion fix and the provider-health fix are deployed. NOT deployed (in the repo, tested): a sturdier evidence-suite cleanup (`_shared/fixture-cleanup.mjs`) and a 60-second budget for the promotion wait.
- **Token incident (all fixed by the owner by hand, all proven):** the Supabase GitHub secret, the Netlify token and the GitHub verify token had expired or been replaced; new ones have long expiry dates in `docs/EXPIRING_TOKENS.md`. The owner still has to save Proton Pass notes and set phone reminders (late Oct 2027) for them.
- **The six staging evidence checks expire after 7 days**: next refresh due about **2026-11-19**.
- Owner dashboard exceptions: **11** (146 old QA failures were cancelled by the owner; the 11 left are explained in the handoff block; none are live).
- The Team hours add-on was built and then CANCELLED by the owner (not building it).
- Unchanged since 2026-10-29 (ask the owner for the current status): the candle client (Light of the World) store, her products and photos; screenshots of the logged-in screens (`/owner/store-look`, `/owner/client-lifecycle`, the setup form).

## Next three safe tasks
1. **Ask whether the repo being PUBLIC is intended** (`nxqweb/nxqweb-v7` shows "Public": source, migrations and docs are world-readable, including secret NAMES and token expiry dates, never values; Actions logs are public too). Then do a full security review (secret scan of files AND git history, tenant isolation, exposed docs) and give the owner a short fix list, including making the repo private (free on GitHub). The owner may have free "Fable" model credits until 2026-11-16 for this.
2. **About Nov 19 (free, gated):** start `run_evidence_suite` together with `deploy_zero_netlify_readiness` (ships the sturdier cleanup); the owner types the phrase and clicks Approve, Claude reads the log; Launch readiness should return to 20/26.
3. **From Nov 23:** run the 4 remaining approve QA runs one at a time (owner: Launch readiness -> Refresh -> Start APPROVE-path QA -> approve the "NXQ QA Disposable <run code>" request that matches the run code -> hands off; about 12-25 minutes each). After each run: the run row, the SQL count, the Netlify credits page. Claude updates `docs/TEN_CLEAN_RUNS_PLAN.md`, the canonical checklist and `docs/LAUNCH_PLAN_JUNE16.md` only after the SQL count is seen. If a run fails: stop, do not retry, read `qa_lifecycle_runs.evidence` and the run's `automation_jobs` rows (queries are in the handoff block).

## Rules in force
- Stop-and-ask gates are in `CLAUDE.md` (workflows, migrations, external services, secrets, deploys, payments, destructive actions). Mutations need the owner's typed `APPLY-NXQ-SUPABASE-STAGING` and the owner's own click on Review deployments -> nxq-staging -> Approve and deploy. Claude may start the guarded workflow through the GitHub tool only for an action the owner approved in the current chat, then gives the run link and a three-field form card.
- Never put a secret value in chat, files, logs or screenshots. Every token must have an expiry date written in `docs/EXPIRING_TOKENS.md`. The owner pastes tokens into Supabase or GitHub secrets by hand.
- Owner prefers: gen-z tone, nice, honest, smart, helpful; options as labeled choices (Option A / B / C) for real decisions; a short done/left checklist at the end of a chat; point to the canonical checklist, never invent a percentage.
- Spending hold on paid keys, lawyer and card until about **July 2027**, which is AFTER the Jun 16, 2027 launch: the AI key, email provider (Resend + domain), scanner (Scanii) and a production Supabase project need a dated owner decision.
- Supabase is on the FREE plan: no backups; creators go on STAGING first (wave 1 = 5 creators, low-stakes content only); a production project with backups before anyone real depends on it.
- Decisions already settled (2026-11-12): `docs/OWNER_DECISION_SHEET.md` (cancel by hand, deletion by hand, free month by hand, sell Business now, theme picks by hand, waitlist via a free outside tool).
- A pending request from the GitHub app "Claude" (new permissions: repository creation write, Dependabot alerts read) was NOT accepted; advice: leave it ignored.

## Owner-only items (Claude cannot do these)
Typed phrase and Approve clicks for every guarded run; starting and approving each QA run; the AI key, Resend account and domain, Scanii account, live Stripe, production Supabase, lawyer review; the launch signoff; Proton Pass notes, phone reminders and deleting the old expired tokens (GitHub fine-grained `nxqweb-staging-verify` and `NXQ deployment verifier`, old Netlify ones, the classic GitHub token "NXQ Web Automation"); confirming whether the three full-access `cli_eyetw...` Supabase tokens are theirs.

## Useful files
`docs/PATH_TO_LAUNCH.md`, `docs/EXPIRING_TOKENS.md`, `docs/TEN_CLEAN_RUNS_PLAN.md` (ledger and credit math), `docs/PROMOTION_DOUBLE_DEPLOY_PLAN.md`, `docs/OWNER_DECISION_SHEET.md`, `docs/LAUNCH_PLAN_JUNE16.md`, `docs/REAL_LAUNCH_GATE.md`, `docs/WAVE_RELEASE_RUNBOOK.md`, `docs/BACKUP_AND_RESTORE.md`, `docs/NXQ_RUNTIME_HANDOFF.md` (full history, long).
