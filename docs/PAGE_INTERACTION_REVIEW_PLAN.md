# Page-interaction review: design options (owner decided 2026-10-09; built locally, NOT deployed)

**Owner decisions (2026-10-09):** Option 1 (top pages inside the daily rollup `summary`), Growth plan and up (same gate as Analytics), per-page views + clicks + deepest scroll, pages with fewer than 3 views in a day hidden. **Built:** draft migration `docs/drafts/migrations/03_rollup_top_pages.sql` (+ sidecar test with a negative control), `src/lib/topPages.ts`, a 'Top pages' table on `/client/business/analytics`, `src/styles/top-pages.css`, `npm run test:top-pages`. **Promoted 2026-10-09 (owner approved) to `supabase/migrations/267_rollup_top_pages.sql`; apply status: see the handoff.** The table fills only after the new rollup runs for days with real events.

Promise audit row: "Conversion / page-interaction review — Thin: raw rollups only; no review view."
Goal: a client-facing view that answers "which pages get attention, and where do visitors drop off?"

## What exists today (verified in the repo, 2026-10-09)

- Raw events live in `website_analytics_events` (service-role only): `event_type` (page_view, click, scroll_depth, mouse_heatpoint), `page_path`, `scroll_depth`, an anonymous session key. They are deleted after the profile's retention days.
- The client-readable table is `website_analytics_daily_rollups` (RLS: a client reads only their own project). It holds DAILY TOTALS only: page_views, clicks, max_scroll_depth, heatpoint_count, plus a `summary` JSON that currently holds only a source marker.
- `rollup_website_analytics_day()` (migration 131) builds those totals from the raw events. Nothing writes per-page numbers anywhere a client can read.
- Privacy finding fixed 2026-10-09 (not deployed): the site script used to send the query string too (`/contact?email=...`). It now sends the path only, and ingest strips `?` and `#` as well. Older raw rows may still contain query strings until retention deletes them.

## Options

**Option 1 (recommended): put `top_pages` inside the existing rollup `summary` JSON.**
Replace `rollup_website_analytics_day()` so each daily rollup also stores the top 10 pages of that day: path, views, clicks, deepest scroll. No new table, no new RLS policy: clients already read their rollups. Needs ONE migration (a function replacement, additive, harness-testable) and the client page reads `summary.top_pages`.
Trade-off: JSON, not queryable by SQL filters; fine for a top-10 view.

**Option 2: a new per-page rollup table** (`website_analytics_page_rollups`: project, date, path, views, clicks, max scroll). Cleaner for later features (per-page history, drop-off funnels). Needs a new table, RLS policies, grants, a function change, and a data-API grant audit entry. More to review; more surface.

**Option 3: query raw events live through a client RPC.** No schema change to rollups, but it would expose raw-event access to clients (a security-definer function), ignores the rollup/retention design, and is the heaviest query. Not recommended.

## Decisions the owner needs to make

1. Option 1, 2 or 3.
2. Which plans see it: Growth and up (same as Analytics), or Intelligence and up only (click and scroll insights are the Intelligence promise).
3. How much to show: only page, views and clicks (simplest); or also deepest scroll per page (a drop-off hint).
4. Small pages: hide pages with fewer than N views per day (suggest 3) so a rare path cannot identify one visitor.

## What I would build after the decision

Migration (draft, harness-tested with a negative control, owner approval to apply) + the client page (previewed for free on a branch preview) + tests. Nothing goes live before the Oct 22 publish.
