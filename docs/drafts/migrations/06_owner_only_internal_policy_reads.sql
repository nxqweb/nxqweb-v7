-- DRAFT (not a real migration; needs the owner's approval to promote and apply).
-- From the 2026-11-13 security review. THIS ONE IS A PRODUCT DECISION, kept separate from draft 05 on purpose:
-- today every signed-in client can read the internal tier policy table and the feature-flag table.
-- Nothing in the app, the Edge functions or any caller-rights database function reads them as a client
-- (the two database functions that use the tier policy table run with definer rights and are not callable
-- by clients), so making both owner-only changes nothing a client can see in the product.

drop policy if exists nxq_economic_policy_public_client_read on public.nxq_tier_economic_policies;
drop policy if exists nxq_economic_policy_owner_read on public.nxq_tier_economic_policies;
create policy nxq_economic_policy_owner_read on public.nxq_tier_economic_policies
for select to authenticated
using (public.is_nxq_owner());

drop policy if exists nxq_feature_flags_authenticated_read on public.nxq_feature_flags;
drop policy if exists nxq_feature_flags_owner_read on public.nxq_feature_flags;
create policy nxq_feature_flags_owner_read on public.nxq_feature_flags
for select to authenticated
using (public.is_nxq_owner());
