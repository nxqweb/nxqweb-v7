# UI redesign plan - "Obsidian & Champagne" premium direction

Written 2026-10-05 (owner request: a premium look "worth hundreds of thousands"). **Nothing in `src/` was
changed.** A static, self-contained prototype of the public home page is in
`docs/design/premium-home/index.html` (open it in a browser; screenshots next to it). It makes no network
requests, is not part of the build, and is not wired into the app.

## Audit of the current public UI (screenshots in `docs/design/premium-home/current-*.png`)

Strengths: dark graphite and gold identity, glass navigation, a strong brand mark, good copy.
Issues seen:
1. **Type scale is too loud.** Headlines are very large and bold with tight leading; on `/plans` the
   heading wraps to four lines and pushes the content below the fold.
2. **System sans-serif everywhere.** There is no display face, so headings look generic rather than luxury.
3. **Small layout bugs:** the hero card chip text breaks mid-word ("Conversi / on focus").
4. **Ten layered stylesheets (7,780 lines)** make consistent polish hard; some effects fight each other.
5. **Visual hierarchy is flat** in the lower sections (many equal-weight glass boxes).

## Proposed direction

- Palette: graphite `#07080b`, champagne gold `#d9b75f` with a lighter and a deeper stop, warm ivory text.
- Type: a refined serif display face (italic accent word) over a clean sans for UI text. The prototype uses
  system stacks; production should **self-host** fonts (no third-party font requests; privacy).
- Glass: fewer, better panels (blur, hairline gold edge, soft shadow), used for the nav, the hero workspace
  and the featured tier only; plain cards elsewhere so glass stays special.
- Rhythm: generous spacing, restrained headline sizes, numbered sections, a clear featured pricing tier.
- Motion: gentle fade-up on load and hover lift; `prefers-reduced-motion` respected.
- Accessibility: visible focus rings, contrast checked, mobile layout verified with no horizontal scroll.

## What "worth hundreds of thousands" realistically needs beyond CSS

A model can deliver the structure, type, spacing and effects. The remaining 30% is **assets**: a real logo
lockup, product screenshots or illustration of the portal, photography or video of finished client sites,
and a self-hosted display font licence. Placeholder visuals should be replaced as those arrive.

## Rollout plan (each step independently verifiable and reversible)

0. Prototype review by the owner (this commit). Choose the direction or request changes.
1. Add design tokens (`src/styles/tokens.css`) and fonts; no visual change yet.
2. Public home, then `/plans`. Both are low risk (no login logic).
3. Public signup and sign-in **visuals only**, never their logic.
4. Client portal shell, then owner portal. These sit next to access control, so changes are
   presentational only and `npm run test:auth-guards` must stay green.
5. Remove dead CSS last, with before/after screenshots.

## Safety rules for every step

- No change to routing, auth, data calls or copy that tests pin (`test:brand`, `test:routes`,
  `test:accessibility`, `test:auth-guards`).
- Before/after: lint, tsc, build, the 67-route browser smoke test (0 flagged), bundle budget, screenshots.
- The live site changes only when the owner enables builds and publishes on Netlify.
- Never touch migrations, workflows or secrets for UI work.
