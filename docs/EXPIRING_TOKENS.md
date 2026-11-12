# Tokens and secrets that expire (names and dates only; NEVER put a value in this file) (written 2026-11-11)

Why this exists: approve run #5 (QA-14EEDD2E57C6, 2026-11-11) failed because Netlify answered 401 to our token; see the ledger in `docs/TEN_CLEAN_RUNS_PLAN.md`. Nothing reminded us a token had an end date. Check this table before every QA run and before launch.

| Supabase Edge secret | Feeds | Token (where it was made) | Expires | Status |
|---|---|---|---|---|
| `NETLIFY_ACCESS_TOKEN` | provisioning, build, promote, reconcile-domain, storefront provisioning | Netlify personal token `nxqweb-supabase-staging-nov2026` | **2027-11-11** (owner phone reminder about 2027-10-28) | replaced 2026-11-11 by the owner; run #5 failed with 401 before this |
| `NXQ_NETLIFY_VERIFY_TOKEN` | read-only verify functions, provider health | same Netlify token as above | **2027-11-11** | replaced 2026-11-11 |
| `NXQ_GITHUB_VERIFY_TOKEN` | 8 read-only verify functions | GitHub fine-grained token (both listed fine-grained tokens, `nxqweb-staging-verify` and `NXQ deployment verifier`, show EXPIRED on GitHub) | unknown, probably already expired | **NOT replaced yet** (next owner task; new fine-grained, read-only, long expiry, pasted by the owner into Supabase) |
| `GITHUB_APP_*` (id, installation id, private key) | repo creation and moving `main` (a GitHub App, not a personal token) | GitHub App | no date known | working (runs #4 and #5 got past the GitHub steps) |

## Old tokens still listed, to review after the new ones are proven (do not delete blindly)
- Netlify: `NXQ Web Automation` (Apr 23), `NXQ Storefront Provisioner` (Jul 30), `NXQ Web Staging Supabase` (Aug 9), `NXQ Staging Provision Worker` (Aug 11): all "No Expiry"; I cannot tell which a live secret still uses. Expired and dead: `NXQ deployment verifier` (Aug 15), `nxqweb-staging-verify` (Nov 8).
- GitHub classic `NXQ Web Automation` (admin:org, repo, workflow, no expiry, "Never used"): nothing in the code uses a classic token; delete after a clean run.

## Rule
Long expiry (about 1 year), the date written here and in Proton Pass, a phone reminder 2 weeks before. Never "No Expiry" for a personal token that acts as the owner.
