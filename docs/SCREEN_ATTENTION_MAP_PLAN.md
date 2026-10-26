# Screen attention map (Intelligence heat-map) — status and promotion steps

Status (2026-10-26): **promoted to migration 279 (owner chose Option A), OFF, NOT applied, not deployed.** The owner approved "Build it" on 2026-10-26 with the rule that nothing goes live until they approve the migration and a deploy.

## What it is (and what it honestly is not)
Intelligence and Enterprise clients get a page, `/client/attention`, with a 16 x 10 grid showing where their website visitors' pointers rested **on the visitor's visible screen**, per page, for the last 7 / 30 / 90 days.

It is **not a page heat-map.** The tracker stores each point as a fraction of the visitor's visible screen (`normalized_x/y`, sampled about every 0.75 s) and no scroll position, so one square can be different content for different scroll positions. All copy says "screen", never "page", and the page says so in plain words.

## Privacy rules (enforced in the database, not the UI)
- Only consented mouse points count (`mouse_heatpoint`); page views are ignored.
- A page is listed only after at least **10 different sessions**; a square is returned only after at least **3 different sessions** (k-anonymity). Thin pages are never revealed, not even by asking for them by name.
- Paths are cut at `?` and `#` (no query strings or tokens).
- No session keys, IP data or raw rows are returned. The raw events table stays service-role only.
- A client can only ever read their own data.

## Gates (all proven in the sidecar test)
Plan feature `behavior_heatmaps` (Intelligence/Enterprise), client approved/active/overdue, billing active/past_due, analytics profile enabled with mouse tracking on. Growth and unapproved clients are refused; mouse-tracking-off and no-project clients get a plain "nothing to show" reason; anon cannot call it.

## Files
- `docs/drafts/migrations/13_screen_attention_map.sql` + `.test.sql` (proven on real Postgres 16 by `scripts/test-local-full-schema.mjs`; breaking the 3-session cell rule makes the test fail)
- `src/lib/screenAttentionMap.ts` (pure logic and copy), `src/components/ClientScreenAttentionMap.tsx`, `src/pages/ClientAttentionRoute.tsx`, route `/client/attention`
- `src/lib/screenAttentionMapConfig.ts`: the ONE switch, `null` = OFF (the page says "not switched on"; the portal card is hidden)
- `docs/drafts/ui/screenAttentionMapSupabaseGateway.ts`: draft gateway (the repo check rejects `.rpc()` calls to functions not in a real migration)
- `scripts/test-screen-attention-map.mjs` (offline), `scripts/test-quick-links.mjs` (conditional portal card)

## Checks run (2026-10-26)
Real-Postgres harness 48/48; offline test passes; `tsc` and eslint clean; browser check with a mock gateway (all four states, light and dark, 390 px wide, axe: 0 violations, no horizontal scroll); `npm run test:ci-parity`.

## Files (after promotion)
Migration `supabase/migrations/279_screen_attention_map.sql`; test `scripts/sql/local-full-schema/regression/279_screen_attention_map.test.sql`; gateway `src/lib/screenAttentionMapSupabaseGateway.ts`; the switch `src/lib/screenAttentionMapConfig.ts` is still `null`; `scripts/preflight-deploy-day.mjs` now expects 278 + 279 pending.

## To go live (each needs the owner's explicit OK)
1. DONE 2026-10-26: promoted to 279 and registered in preflight.
2. `manual-supabase-stage.yml`: read-only `validate_foundation` first; the dry run must list exactly 278 and 279; then `apply_migrations` (owner approves with the phrase and clicks Approve and deploy).
3. After apply: set `screenAttentionGateway = createScreenAttentionGateway(supabase)` in the config file (and the Q&A switch for 278), commit.
4. One batched site deploy (15 Netlify credits), same single-trigger-commit method as before.
5. Real proof: an Intelligence test client with real consented visits on a live site; until then, say "built, proven on test data only".
Note: it needs no new Edge function. Only clients whose published site has the tracker snippet and visitors who consent produce data.
