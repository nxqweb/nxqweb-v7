# Owner security settings check: the dashboard settings Claude cannot see (written 2026-11-13)

Why this exists: the 2026-11-13 security review read the code and a local stand-in database. It could NOT
see the live settings below. Each line is a look-and-confirm for the owner (a few minutes in total, no
money). Tell Claude the result in chat; do not paste secrets or screenshots that show a secret value.

## GitHub (repository Settings; the repo is public on purpose, see `CLAUDE.md`)
| # | Where | What should be true |
|---|---|---|
| G1 | Code security -> Secret scanning | Enabled, with **Push protection** on (free for public repositories). It blocks a push that contains a known secret format. |
| G2 | Code security -> Dependabot alerts | Enabled (free). Alerts only; no automatic pull requests needed. |
| G3 | Actions -> General -> Fork pull request workflows | "Require approval for all outside collaborators" (or stricter), so a stranger's pull request never runs workflows unreviewed. |
| G4 | Actions -> General -> Workflow permissions | "Read repository contents" as the default; "Allow GitHub Actions to create and approve pull requests" OFF. |
| G5 | Environments -> `nxq-staging` | "Required reviewers" lists only the owner; "Deployment branches" limited to the safe branch (this is the Approve gate). |
| G6 | Collaborators and teams | Only accounts the owner recognises have access. |
| G7 | Account -> Password and authentication | Two-factor authentication is on for the owner account. |

## Supabase (project `nxqweb-staging`)
| # | Where | What should be true |
|---|---|---|
| S1 | Authentication -> Sign In / Providers -> Email | "Confirm email" ON. |
| S2 | Authentication -> password settings | A minimum length is set; leaked-password protection ON if the plan offers it. |
| S3 | Authentication -> URL Configuration | Site URL and redirect URLs list only the project's own sites (no wildcards to unknown domains). |
| S4 | Storage -> Buckets | `client-files` and `commerce-product-media` are PRIVATE; only `commerce-product-images` and `commerce-website-content` are public (they hold storefront pictures). |
| S5 | Advisors -> Security Advisor | Read the list; send Claude the titles of anything marked Error or Warn. |
| S6 | Account -> Access Tokens | Only tokens the owner recognises; each has an expiry (see `docs/EXPIRING_TOKENS.md`). |
| S7 | Account security | Two-factor authentication is on for the owner account. |

## Netlify
| # | Where | What should be true |
|---|---|---|
| N1 | User settings -> Applications -> Personal access tokens | Only tokens the owner recognises; the old "No Expiry" ones are removed once the notes are saved (see `docs/EXPIRING_TOKENS.md`). |
| N2 | Team -> Members and account security | Only the owner; two-factor authentication on. |
| N3 | Main staging site -> Build settings | Builds stay STOPPED (never "Activate builds"). |

Menu names move over time; if a setting is not where this page says, tell Claude what the screen shows.
