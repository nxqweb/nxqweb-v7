# NXQX master site, one domain, and name check (plan only, 2026-10-05)

Nothing here is built or bought. Not legal advice: a trademark lawyer should confirm the name before you spend on branding.

## 1. One NXQX site with every branch inside it (owner's goal)
Today the app's home page (`/`) is the NXQ-Web marketing page, and `/portal`, `/client`, `/owner`, `/plans`, `/store/*` hang off
the same site. That already works on a single domain. To make NXQX the master brand:

| Option | Looks like | Work | Notes |
|---|---|---|---|
| **A. Paths (recommended)** | `nxqx.example/` = NXQX hub; `/web` = NXQ-Web; later `/booking`, `/commerce`... | Small frontend change: new hub page at `/`, move today's home to `/web`, keep `/portal`, `/client`, `/owner` exactly where they are | One domain, one SSL certificate, one Netlify site, no extra cost. Old links keep working if `/` keeps a clear "NXQ-Web" button |
| B. Subdomains | `web.nxqx.example`, `support.nxqx.example` | DNS records per branch; may need separate Netlify sites | Still one domain purchase (subdomains are free); more moving parts |
| C. Separate domains | `nxqweb.com`, `nxqxsupport.com` | Most cost and DNS work | Only worth it if a branch becomes its own company |

Support and outreach do not need their own domains: use `nxqx.example/support` for the help page and a support mailbox on the
same domain. **Exception:** cold outreach email should go from a separate sending subdomain or a second cheap domain, so spam
complaints cannot hurt the main domain's email reputation (see `docs/OUTREACH_MIGRATION_PLAN.md`).

Client websites stay on the clients' own domains (they own them); nothing about that changes.

## 2. Which domain to buy (when you have a card)
`nxqx.com` is taken (four-letter .com names are usually pre-bought). Availability and prices could not be checked from this
environment; typical yearly prices below are rough and must be checked at purchase:
- **Good first choices:** `nxqx.co`, `nxqx.io`, `nxqx.app` (needs HTTPS, which Netlify provides), `nxqxhq.com`, `getnxqx.com`.
  A .com with a short word (`nxqxhq.com`) is about $10-20/year; .io/.co about $30-60/year; .ai is often $70+ for a 2-year minimum.
- **Buy one main domain** for the site and normal email. Optionally a second cheap domain later just for cold outreach.
- Turn on registrar privacy and auto-renew; keep the domain in an account only you control.

## 3. Name check for "NXQX" (what was and was not checked)
- **Not checked here:** the US trademark database (USPTO) is blocked from this environment, so no search result is claimed.
- **Do this yourself (free, ~15 minutes):**
  1. USPTO trademark search (tmsearch.uspto.gov): search `NXQX`, `NXQ`, and close spellings (`NXQ-X`, `NEXQX`). Look especially at
     class 42 (software/SaaS, website services) and class 35 (business/marketing services). A live mark in those classes for a
     similar name is the main risk.
  2. Your state's business-name registry (Secretary of State) for an existing "NXQX" business.
  3. A plain web search and app stores for products already called NXQX/NXQ.
- **Risk in plain terms:** short letter-strings are hard to register only if someone already uses something confusingly similar
  for similar services. If the search is clean, filing a US trademark application for NXQX in class 42 (and maybe 35) is the way
  to protect it; the USPTO fee is charged per class (verify the current fee on uspto.gov before filing).
- Branch names (`NXQ-Web`, `NXQ-Business`, ...) ride on the same check; changing them later costs more than checking now.

## 4. Order
Owner runs the name checks -> lawyer confirms -> buy the main domain -> (approval) frontend change for Option A -> connect the
domain in Netlify -> set up the email domain (SPF/DKIM/DMARC) -> later, a separate outreach sending domain.
