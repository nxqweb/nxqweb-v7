# CLAUDE.md — operating rules for this repository

This file governs how any Claude Code session works in `nxqweb-v7`. It is
permanent standing instruction, not a one-off task note. Product rules live
in `README.md`; live operational state lives in
`docs/NXQ_RUNTIME_HANDOFF.md` — read both before acting.

## Branch discipline

- Never work directly on `main`.
- All work happens on the current safe checkpoint branch (currently
  `safe/checkpoint-autonomy-wave35-sales`). Verify the branch and HEAD SHA
  against `origin` before starting any session (`git fetch`, `git rev-parse
  HEAD`, `git ls-remote origin refs/heads/<branch>`) — do not trust a stale
  local checkout.

## Autonomy rules

- **"Now what?", "continue", or equivalent** means: inspect current repo
  state (git log, git status, open checklist items in
  `docs/NXQ_RUNTIME_HANDOFF.md`), choose the single highest-priority safe,
  well-defined task, and proceed automatically without waiting for further
  instruction.
- **"Let's do it" (or agreement to a proposed task)** means: execute the
  recommended task through local checks, commit, and push — provided it is
  inside the allowed safe scope below. Do not stop mid-task to re-confirm
  steps that are already inside that scope.
- Do not ask for confirmation after every small task. Batch routine
  progress into the post-task report described below instead of pausing to
  ask.
- Allowed autonomous scope: local application source, scripts, tests,
  documentation, and commits/pushes to the current safe branch.

## Workflow dispatch (owner request, 2026-10-06)

The owner asked not to fill in GitHub's "Run workflow" form by hand. So:

- Claude MAY start `manual-supabase-stage.yml` (and similar manual staging workflows) itself through the GitHub tool, **only** for an action the owner has
  explicitly approved in the current chat (the specific migration number or function deploy, plus the exact confirmation phrase for mutations).
- For migrations: always run the read-only `validate_foundation` first, read the "Migration dry run" log myself, and apply only if it lists exactly the approved
  migration(s). Anything else, stop and ask.
- After dispatching, give the owner the direct run URL (`https://github.com/<owner>/<repo>/actions/runs/<id>`, found by listing the newest run). The owner's
  "Review deployments -> nxq-staging -> Approve and deploy" click is theirs and is never done or worked around by Claude.
- After the run, read the log and report what actually happened ("Applying migration ..." lines, pass/fail), not just the green check.
- Nothing here widens the hard stop-and-ask gates above: new approvals are still needed for new migrations, deploys, secrets, billing or production.

## Hard stop-and-ask gates

Stop and ask for an explicit decision before touching any of the following,
regardless of how confident the change looks:

- GitHub Actions/workflow files (`.github/workflows/**`)
- Database migrations (`supabase/migrations/**`) and any migration apply
  action
- External services: Supabase, Netlify, GitHub App/client infra, DNS,
  Stripe, notification/malware/AI providers, or any other third party
- Secrets or credentials of any kind — never place a value in chat, source,
  logs, or workflow inputs, even to describe a fix
- Deployments (staging or production) and any production-facing action
- Payments, billing, or payout configuration
- Any destructive action (force-push, history rewrite, `git reset --hard`,
  deleting branches/files whose purpose is unclear)
- Any change carrying material compatibility risk (breaking public
  contracts, schema-shape changes, cross-tenant data exposure risk)

A real product decision (not just a technical implementation choice) is
also a stop-and-ask matter even if no gate above is literally touched.

## Post-task reporting

After every safe task, report:

1. Exact files changed (path list, not just a summary)
2. Checks run and their exact results (pass/fail, not "looks fine")
3. Commit SHA and push result
4. Any real uncertainty or judgment call made
5. Checklist/status movement — **only** when an actual row in
   `docs/NXQ_RUNTIME_HANDOFF.md` or `docs/LAUNCH_HARDENING_CHECKLIST.md`
   changed state; do not restate unchanged rows

## Handoff Protocol

When the user says **"handoff," "new chat," "chat is too long,"** or
equivalent:

1. Finish the current task if it is close to done; otherwise leave it in a
   safe, clearly-committed or clearly-stashed state — never mid-edit.
2. Update `docs/NXQ_RUNTIME_HANDOFF.md` with:
   - exact branch and HEAD SHA
   - working-tree state (clean/dirty) and any uncommitted files
   - completed work since the prior handoff
   - checks run and their exact results
   - current product decisions and hard rules in force
   - confirmed blockers/risks
   - the next 3 highest-priority safe tasks
   - an exact instruction for the next session: read `CLAUDE.md` and this
     handoff file, inspect live git state against `origin`, and resume
3. Commit and push the handoff update to the safe branch.
4. Give the user one short "new chat starter" sentence — nothing else.

## End-of-chat reporting (user preference)

- **At the end of every chat/session**, reference the canonical launch
  checklist at the top of `docs/NXQ_RUNTIME_HANDOFF.md` ("Canonical
  launch checklist") — do not invent a fresh percentage. If this chat's
  work changed a line's status, update that checklist (and only that
  line) as part of the chat; otherwise just point to it as-is. It already
  keeps "code completion" (section A), "staged migrations" (section B),
  and "live launch verification" (section C) separate — never collapse
  them into one number.
- **Whenever presenting the user a decision** (not a routine implementation
  choice — a real fork in direction), offer it as clearly labeled options
  (Option A / B / C, or via the `AskUserQuestion` tool's pop-up-style
  selection) rather than open-ended prose asking "what do you want to do?"
- **At the end of a chat that did concrete work**, include a short
  done/left checklist for that chat specifically (checkboxes: what shipped
  this chat, what's still open from it).

## Verification discipline

- Treat a locally cached `origin/<branch>` ref as untrusted until refreshed
  with `git fetch`; a stale ref has previously caused a reported checkpoint
  to disagree with the real remote tip.
- Do not report a feature, migration, or contract as "not implemented" or
  "not on this branch" without grepping/reading the actual files first —
  a prior session's assumption here did not match the repository state.
- Before every push, run `npm run test:ci-parity` (the exact commands GitHub CI runs). `npm run test:*` and
  `eslint --quiet` are not a substitute; a red push emails the owner once per failing workflow.
- Local lifecycle simulations and contract validators are not external QA
  evidence; do not conflate them with staging/production readiness.
