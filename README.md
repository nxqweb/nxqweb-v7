# NXQ Web V11

NXQ Web is a multi-tenant website operations platform with shared owner/client authentication, Business website onboarding and automation, Commerce management, guarded provider orchestration, and tenant-derived portal read models.

## Product rules

- Signup creates a lead; completed intake creates one owner `APPROVE`/`DENY` decision.
- `DENY` is a hard stop and must create no provider infrastructure.
- One `APPROVE` starts an idempotent backend lifecycle. Provider retries must reuse checkpointed resources.
- Supabase is the source of truth. Browser code does not receive service-role credentials or direct control-plane mutation authority.
- Preview and production are distinct. Production promotion is exact-commit, fast-forward-only, and remains locked until verified.
- Client files, domains, messages, and other tenant data are read through authenticated tenant-derived boundaries.
- Commerce remains a supported product family and must not be removed while Business automation evolves.

## Local verification

Install the locked dependencies and run the full release gate:

```bash
npm ci
npm run test:release
```

Useful focused checks:

```bash
npm run test:runtime-stage
npm run test:migrations
npm run test:edge
npm run test:security
npm run test:accessibility
npm run test:lifecycle
```

The local lifecycle simulation proves deterministic application behavior only. It does not count toward the required external Business QA evidence.

## Runtime and release safety

- Edge deployment/auth boundaries are declared in `scripts/edge-function-manifest.mjs` and `supabase/config.toml`.
- Staging mutations use the protected `nxq-staging` GitHub environment and the confirmation-gated manual workflow.
- Production remains blocked until 10 consecutive disposable external Business QA runs pass with real Supabase, GitHub, and Netlify evidence, followed by recovery proof and explicit owner signoff.
- Never merge, publish production, change DNS, or enable billing merely because local checks pass.

See `docs/NXQ_RUNTIME_HANDOFF.md` for the current operational checkpoint and staging continuation order.
