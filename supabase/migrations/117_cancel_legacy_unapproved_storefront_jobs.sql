-- Close the legacy gap for provisioning rows created before migration 113.
-- Never cancel the known approved QA job or any other job with an accepted website setup approval.

update public.commerce_storefront_provisioning p
set status = 'cancelled',
    locked_at = null,
    lock_token = null,
    last_error = 'Provisioning cancelled because no accepted owner website setup approval exists.',
    error_step = 'owner_approval_required',
    provider_metadata = coalesce(p.provider_metadata, '{}'::jsonb)
      || jsonb_build_object(
        'cancelled_by_guard_migration', true,
        'cancelled_at', now(),
        'cancel_reason', 'owner_approval_required'
      ),
    updated_at = now()
where (
    p.status in ('queued', 'failed')
    or (
      p.status = 'processing'
      and (p.locked_at is null or p.locked_at < now() - interval '15 minutes')
    )
  )
  and not exists (
    select 1
    from public.owner_approval_requests a
    where a.client_id = p.client_id
      and a.request_type = 'website_setup_review'
      and a.status = 'accepted'
  );
