# Founding-client program (owner decisions 2026-10-05)

**Status:** public text section built (home page, `src/components/FoundingClientProgram.tsx`, numbers in
`src/lib/foundingProgram.ts`). Nothing is charged, discounted, counted or enforced automatically.

## Decisions
- 5 **testing** spots: 50% off for **12 months** from signup, in exchange for honest feedback and, only if the client agrees in
  writing, permission to share results (feeds `src/lib/socialProof.ts`).
- 10 **founding** spots: free service under written terms.
- Program closes when the spots are filled or at 10,000 clients, whichever comes first. Today the owner closes it by hand
  (`enabled: false`). Every spot is approved by hand; applicants email the support address.
- Public page shows NO spots-left counter and no urgency copy (a counter must read a real server count).

## What it needs before it is real (all gates unless noted)
1. **Terms for the free spots (lawyer).** Points for the lawyer: service may end if NXQ-Web stops operating or the business
   closes; no uptime guarantee; fair-use limits; data export/return on end; what happens to the domain (client-owned);
   revocation for abuse; no transfer. The public page currently says only "terms apply, including that service can end if
   NXQ-Web stops operating" - the lawyer should confirm that wording before the next publish.
2. **Billing (blocked on the payment card):** a 50% coupon cannot exist until Stripe is connected. Until then testers are
   tracked by hand.
3. **Database (migration, approval needed):** a `founding_program_grants` table (client, kind `tester|free`, discount %,
   starts_at, ends_at, approved_by) so the program is countable and auditable; a view or RPC with the real count for an
   optional public counter and for the 10,000-client automatic close.
4. **Free-spot economics:** the margin rule gives a $0 plan a $0 provider budget, which would block that client's usage. Model
   free spots as an explicit "complimentary" grant with a fixed monthly provider budget (for example the Starter ceiling), not as
   a $0 price. Cost is small and capped (10 sites); the real watch item is Netlify credits (`max_builds_per_cycle`).
5. **Margin check:** Starter at 50% off is $25. Estimated cost is about $2-5 per site per month (unverified, see
   `docs/UNIT_ECONOMICS_AND_SCALE.md`), so it stays profitable. Re-verify the vendor numbers before relying on them.

## Order of work
Lawyer terms -> approve the grants migration (draft + local test under `docs/drafts/migrations/`) -> guarded apply -> admin view for the owner
to grant/revoke -> optional public counter -> Stripe coupon when billing exists.
