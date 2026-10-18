# Draft Edge-function changes (NOT applied)

CI (and the local full-schema harness) reject any `.rpc("name")` in `supabase/functions/` whose database function is not in a real migration. Worker changes that call
a draft function therefore wait here as a patch until the migration is promoted. Apply with `git apply` in the SAME commit that promotes the migration, then run
`npm run test:edge`, `npm run test:ci-parity` and the local full-schema harness.

| Patch | Needs migration | What it does |
|---|---|---|
| `build-business-website-photos.diff` | draft 10 (`get_site_photos_for_build`) | The site builder downloads each clean + released "Our work" photo, checks its real type from its bytes and that its SHA-256 equals the scan's fingerprint, commits it as `gallery/work-NN.ext`, deletes gallery files the build did not write (removed or flagged photos), writes the gallery block into `site.config.js`, and FAILS (retries) instead of silently dropping photos when the list cannot be read. Pure rules live in `supabase/functions/_shared/site-photos.mjs` (tested). |

`scripts/test-site-photos.mjs` checks that the patch still applies to the current builder and that it contains the safety rules, so it cannot rot unnoticed.
