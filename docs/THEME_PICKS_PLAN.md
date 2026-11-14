# Making the color picks apply to generated sites: the real footprint and a decision (written 2026-11-04)

**Status: PLAN ONLY, nothing built.** This is task 3 from the 2026-10-29 handoff. It was looked at overnight and deliberately NOT built unattended: it touches the core build path and needs look-and-feel choices that are the owner's. Nothing here is gated by itself, but shipping any of it needs a `deploy_functions` run (an approval) and one site build.

## What exists today
The "Request your website" form lets a client pick a **color theme** (six named themes plus "NXQX picks for me"), a **background** (five plus "NXQX picks"), type **own colors** as free text, and pick **light / dark / both**. Only light / dark / both reaches the generated site today (`supabase/functions/_shared/site-options.mjs` -> `site.config.js` and the page's `data-mode`). The theme, background and own colors are written into the signed setup report for the owner and the AI build plan, and nothing applies them (`src/lib/websiteBrief.ts`).

The generated-site template (`templates/business-v1/styles.css`) already has a theme mechanism: `data-theme` with **four** allowed themes: the default `midnight_blue` and three alternates, `charcoal_gold`, `forest_emerald` and `royal_violet`, each alternate with a dark and a light accent set (`supabase/functions/prepare-build-plan/index.ts` line 49 and `templates/business-v1/app.js` line 134 list exactly these four). The AI build plan chooses one of those four.

## How the client's six themes line up with the template's four
| Form theme (swatches) | Closest template theme | Fit |
|---|---|---|
| Classic navy and gold (#1d2f4f, #c9a24a, #fdf9f6) | `charcoal_gold` | gold accent matches, dark base differs |
| Warm earth (#8a5a3c, #d9b99b, #faf6ef) | `charcoal_gold` | warm, but not earthy brown |
| Fresh green (#2f6f4f, #9bd3a8, #f4faf5) | `forest_emerald` | good |
| Ocean blue (#0b4f8a, #6bb7e0, #f3f9fd) | the default `midnight_blue` | good |
| Bold black and red (#111111, #c4122f, #ffffff) | none | no red theme |
| Soft pastel (#f4b6c2, #b8d8e8, #fffaf5) | none | no pastel theme |

## The footprint if the picks should really apply (why this is not a quick job)
Theme names are listed in many places that must stay identical, several guarded by drift tests:
- the template: `templates/business-v1/styles.css` (dark and light blocks per theme) and `app.js`;
- the build-plan validators in four Edge functions: `prepare-build-plan`, `build-business-website`, `generate-business-build-plan`, and `_shared/build-plan-staging-fallback.ts`;
- the AI Desk kit's copies: `src/lib/aiDesk.ts` and `src/lib/aiDeskCheck.ts` (a drift guard fails if they differ from the functions);
- the five example sites in `public/examples/*` (copies of the template assets; `node scripts/build-example-sites.mjs --write` regenerates them, and CI checks drift);
- tests: `scripts/test-site-options.mjs`, `scripts/test-ai-desk.mjs`, `scripts/test-build-plan-fallback.mjs`, `scripts/test-example-sites.mjs`, the manual browser check `scripts/manual/site-options-e2e.mjs`, and the CI accessibility (axe) runs.
New themes also need dark AND light variants whose text passes contrast (WCAG AA is the repo's standard), so each palette has to be checked, not just chosen.

## What cannot be automatic
- **Own colors** is free text. Reading "make it dusty rose with sage" into hex values safely needs the AI key or a person; it stays a by-hand step, recorded in the report.
- **Background** styles (white, cream, dark, gradient, photo) mix with the light/dark mode and a photo background depends on the photos pipeline. Only "dark" and "clean white" map cleanly onto today's modes.

## Options (owner decision)
- **Option A: map, do not add.** Send the picks that have a reasonable template match (navy-gold and warm earth -> `charcoal_gold`, green -> `forest_emerald`, ocean -> default) and leave red and pastel manual. Small change (the report-to-plan mapping plus tests), no new CSS, no example regeneration. Honest limit: the match is "closest", not exact.
- **Option B: add the missing themes** (at least bold red and soft pastel, ideally all six) with dark and light sets and contrast checks. Full fidelity, but it touches every place in the footprint list and regenerates the examples.
- **Option C: stay manual** until after the June 16 launch; the owner sets the look by hand when approving, as today. Zero risk.

**Recommendation:** Option C for the first creators (hand-set, and their sites double as the design test), then Option A once enough real picks show which themes people actually choose; Option B only if creators ask for red or pastel. Whatever is chosen: the code can be written and tested on the safe branch for free (builds are OFF), but it reaches a client's site only after an approved `deploy_functions` run and one site build.


## DECISION 2026-11-12 (owner took the defaults)
Option C for the first creators (looks set by hand per creator when approving); Option A (map the picks to the closest template theme) only after the first creators show which themes people choose. Nothing to build now.
