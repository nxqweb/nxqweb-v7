# Client logo upload: plan (decided with the owner 2026-11-21; NOT built; built after the QA window)

Goal: a client uploads THEIR OWN logo (never a copy or redraw), as big as they have it; everything after that is automatic and free.

## Already built and tested (source only, nothing wired yet)
- `src/lib/logoRules.ts` + `scripts/test-logo-rules.mjs`: file kinds, size advice (SVG great; 2000 px or more great; 1000 to 1999 fine with a note; under 1000 is a WARNING the client acknowledges, never a block), the required rights tick, the 10 MB and 1 MB SVG limits, SVG safety (unsafe SVGs are REFUSED, not cleaned), stored size cap 2400 px.
- `src/lib/logoCutout.ts`: automatic transparent background, margin trim, icon extraction, smooth enlarge, `crispLogoSize` (each store shows its logo at twice its real width, 220 to 900 px).

## Still to build (gated: needs a migration, so the owner approves it and it is applied on a deploy day AFTER the ten clean runs)
1. **Storage for the logo.** Today the store look's logo may only be a file shipped inside the site (`/brand/...`, checked by `nxq_store_look_problem`, migration 286). A client upload needs a private-write, public-read place (a new storage bucket or a path in an existing one) and the look check extended to accept that exact path pattern for the client's own folder. Additive only; do not change existing behavior.
2. **Who may write.** Only the logged-in client, only into their own folder, through the existing upload ticket function (`nxq_authorize_storage_upload`, migration 246: approved, billing active, quota, scan). Add the new bucket name to its allow-list in a NEW migration.
3. **The upload screen** (client Commerce, near Live store): choose file, live size advice from `logoSizeAdvice`, the acknowledgement tick for small logos, the rights tick, preview with the automatic cutout, Save. Optional: run the free in-browser upscaler once here (lazy loaded, MIT `upscaler` + `@upscalerjs/esrgan-slim`, about 1 MB model; gain is small, see the handoff).
4. **Save.** Shrink to at most 2400 px, upload through the ticket, then set the store look's logo to the new public URL with the client's own look function (a client version of `owner_set_store_look` limited to the logo field), or let the owner approve it on `/owner/store-look`.
5. **SVG path.** Check with `svgProblems`; refused SVGs get a plain message. Serve with the correct type and a restrictive Content-Security-Policy header so a stored SVG can never run script.
6. **Rights tick wording** is on the owner's lawyer-review list.

## Hard rules
- Nothing here may change the build pipeline, `templates/business-v1`, or anything the QA runs use. New code stays inert (switched off) until approved. `deploy_functions` ships ALL functions, so any new function must be harmless when called.
- Never redraw or trace a client's logo. Never store anything the client has not ticked rights for.
