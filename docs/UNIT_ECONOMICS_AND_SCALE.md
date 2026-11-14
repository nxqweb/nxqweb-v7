# Unit economics, AI model plan, scaling, and waitlist notes

Written 2026-10-04 from a planning conversation. **Nothing here is built.** Prices marked
(unverified) come from memory; the vendor pricing pages could not be fetched from the build
environment. Only GitHub's plan (unlimited private repos on Free; Team $4/user/month) and the
Claude model prices (cached table dated 2026-09-25) were checked. Re-verify every other number
before using it for pricing decisions.

## 1. AI model plan (hybrid)

- **Build with a strong model on $150+ tiers.** Rough one-time cost for one site build: about
  $3.40 per full pass on Fable 5.1 ($10 in / $50 out per million tokens), about $14 for a draft
  plus ~3 revision passes. Assumption: ~40k tokens in, ~60k out per pass. Illustrative, not
  measured.
- **Cheap model for maintenance** (change-request classification etc.): Sonnet 5.5 ($2/$10) or
  Haiku 4.5 ($1/$5).
- **Most checks need no AI.** Deployment verification, safety checks, SSRF guards are plain code.
  AI is used only in the build plan and the change classifier.
- **Code gap:** the AI adapter (`generate-business-build-plan`) supports only
  `openai_responses` and `openai_chat_completions`. Using Claude means adding a protocol option
  and a guarded staging deploy of that function.
- **Margin rule in the database:** target 90%, hard minimum 85%. Monthly AI budget per client:
  $50 plan -> $5.00 included / $7.50 ceiling; $100 -> $10 / $15; $150 -> $15 / $22.50;
  $200 -> $20 / $30. A ~$14 Fable build fits $150+ but is borderline at $100 and breaks $50.
  Purchased usage credits exist for overflow.
- **Plan:** measure real token costs on one Sonnet 5.5 sample and one Fable 5.1 sample before
  setting prices.

## 2. Estimated monthly cost per website (~100 clients, illustrative)

| Item | Estimate | Verified |
|---|---|---|
| Supabase Pro (one project serves all clients) | ~$25/mo, more with compute upgrade | no |
| Netlify (one site per client, credit-based) | ~$20-50/mo plus credits | no |
| GitHub | $0 (Free: unlimited private repos) | yes |
| Cloudflare Turnstile | free | no |
| Malware scanning | provider-dependent (see section 5) | no |
| Resend email | free to ~3k emails, then ~$20/mo | no |
| Domains | $0 to NXQ (client-owned) | by design |

Fixed ~$75-150/mo total (~$1-1.50/client at 100 clients). Variable ~$1-3/client/mo (AI
classification, a few Netlify deploys, email). **Roughly $2-5/site/month** plus one-time build.
The tight spot is Netlify credits. Note: `nxq_netlify_budget_settings.max_builds_per_cycle`
defaults to 4 for the whole account and must be raised as clients are added.

## 3. Scaling beyond ~10,000 users

- Migration 202 added provider pools (source/hosting/ai/email/database...), per-client
  placement (`client_infrastructure_placements`, shard keys), capacity windows, and scale
  modes (standard 300/min, high_capacity 3,000/min, massive 15,000/min "requires sharded
  provider capacity").
- DB functions `nxq_choose_provider_pool` and `nxq_ensure_client_placement` exist, but no Edge
  function or page calls them: **groundwork, not wired.** The core database is not sharded.
- Client sites are static on Netlify, so visitor traffic mostly does not hit Supabase. One
  Supabase project likely carries far more than 10,000 clients before sharding is needed.

## 4. Pre-order / waitlist idea (not built)

- Not in the code today (existing lead intake is for clients' sites, not NXQ itself).
- Shape: public page + email-capture table + Turnstile (already built) + consent and
  unsubscribe; free "reserve your spot", no payments.
- Decision needed: free waitlist vs paid deposit (deposit needs Stripe, refund terms, legal
  care; recommend free for now).
- Marketing video: show outcomes, tiers, pricing; not how it is built; promise only what is
  proven live; give launch timing as a target.
- Build effort: a new migration (approval gate), a page, one function.

## 5. Malware scanner options (unverified, memory only)

Cloudmersive is blocked for the account as of 2026-10-03 (see handoff). The scanner code is
one small function (`malware-scan-provider-adapter`) specific to Cloudmersive's request and
response shape (`inputFile`, `Apikey` header, `CleanResult`/`FoundViruses`), so switching is a
small rewrite plus a guarded staging deploy. Checks for any candidate: commercial use allowed;
client files not shared; DPA available; simple HTTP API; clear free/pay-as-you-go pricing
(default file limit 3.5 MB).

| Option | Notes |
|---|---|
| ClamAV self-hosted | Free engine, no vendor lock-in, files stay in your control; needs a small server (~$5-15/mo) and signature updates; single engine |
| MetaDefender Cloud (OPSWAT) | Established, multi-engine, reportedly a free tier; limits and commercial terms unverified |
| Scanii | Developer-focused, pay per scan; free tier unverified |
| Cloudmersive paid | Already built against; account currently blocked |
| VirusTotal | **Avoid** for client files: free API is non-commercial and uploads become visible to others |

## 6. Open decisions from this conversation

- Signature/premium tier (about $200/mo plus setup fee) vs keeping tiers (needs migrations ->
  approval gate)
- Hybrid AI plan: approve a measured Sonnet-vs-Fable sample once the AI provider is configured
- Waitlist: free vs deposit
- Malware scanner: wait for Cloudmersive vs switch (decide ~Wednesday/Thursday)
