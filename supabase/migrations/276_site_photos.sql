-- Migration 276: Website photos at setup (owner request 2026-10-18: "the pictures at one set up, then update the site and add pictures").
-- Promoted from draft 10 on 2026-10-18 on the owner's go ("lets do all of that"). NOT APPLIED: the owner applies it with the guarded workflow, see docs/PHOTO_BACKEND_RUNBOOK.md.
--
-- What it changes and adds:
--  1. nxq_authorize_storage_upload (migration 246) is redefined with ONE rule relaxed: a client whose billing is already active (paid) may upload IMAGES
--     (jpeg/png/webp) to the client-files bucket while their website setup is still being prepared or reviewed (status lead / intake_received / needs_owner_review). Everything else is unchanged: unpaid accounts still cannot upload, other file types and the Commerce buckets still need an approved
--     account, the monthly storage allowance and the one-time upload ticket still apply, malware scanning still restricts every file until it is clean.
--  1b. The monthly storage allowance (a per-client policy that migration 246 only creates at approval) is also created when a PAID client is still in setup, and
--     the trigger now watches billing_status. Without this step the relaxed rule above would still fail with "No server-side resource policy is configured".
--  2. client_site_photos: which uploaded images the client wants on their website and in what role ('work' = shown in the Our work gallery, 'site' = other
--     photos for the NXQX team), with a description (alt text), an optional caption and an order. Deny-by-default table; access only through the functions below.
--  3. list_my_site_photos / save_my_site_photo / remove_my_site_photo: tenant-derived client functions (the client is found from the login, never from an argument).
--  4. get_site_photos_for_build(client): service-role only. Returns ONLY photos whose scan came back clean AND released, for an approved, non-QA, running client, together
--     with the scan's content hash so the builder can prove the file it downloads is the very file that was scanned. This is the single place that rule lives.
--
-- NOT in this draft: copying the photos into the client's site (that is the build worker, supabase/functions/build-business-website), any scanner secret
-- (Scanii is an owner step, see docs/MALWARE_PROVIDER_SCANII_PLAN.md), or any change to who can approve a client.

-- (1) Upload authorization: migration 246's function with ONE rule relaxed (see the comment inside).
create or replace function public.nxq_authorize_storage_upload(
  target_bucket_id text,target_object_path text,target_file_size bigint,target_mime_type text
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare c record; max_size bigint; ticket_id uuid; key_value text; reserve_result jsonb;
begin
  if auth.role()<>'authenticated' or auth.uid() is null then raise exception 'Authenticated client access required.'; end if;
  select cl.id,cl.status::text client_status,cl.billing_status::text billing_status,cl.pipeline_stopped_at,
    pf.slug family_slug,pft.tier_key into c from public.clients cl
  join public.product_families pf on pf.id=cl.product_family_id and pf.is_active=true
  join public.product_family_tiers pft on pft.id=cl.product_tier_id and pft.product_family_id=pf.id and pft.is_active=true
  where cl.auth_user_id=auth.uid() order by cl.created_at desc limit 1 for update of cl;
  if c.id is null or c.pipeline_stopped_at is not null or c.billing_status not in ('active','past_due') then
    raise exception 'Upload denied by account, tier, or billing state.';
  end if;
  if c.client_status not in ('approved','active','overdue') then
    -- Paid clients may upload website PHOTOS (images only, client-files bucket only) while they set up, before the owner approves the setup.
    -- Billing being active is what makes this safe: unpaid accounts still cannot upload anything. Every other bucket and file type keeps the old rule.
    if not (c.client_status in ('lead','intake_received','needs_owner_review')
            and target_bucket_id='client-files'
            and lower(btrim(coalesce(target_mime_type,''))) in ('image/jpeg','image/png','image/webp')) then
      raise exception 'Upload denied by account, tier, or billing state.';
    end if;
  end if;
  if split_part(target_object_path,'/',1)<>c.id::text or target_object_path like '%..%' or target_object_path like '/%' then raise exception 'Upload path is outside this client workspace.'; end if;
  if target_bucket_id='client-files' then max_size:=26214400;
  elsif target_bucket_id in ('commerce-product-media','commerce-product-images','commerce-website-content') then
    if c.family_slug<>'commerce' then raise exception 'Commerce storage requires a Commerce subscription.'; end if;
    max_size:=10485760;
  else raise exception 'Unsupported upload bucket.'; end if;
  if target_file_size<=0 or target_file_size>max_size or nullif(btrim(target_mime_type),'') is null then raise exception 'Upload size or type is invalid.'; end if;
  with expired as (
    update public.nxq_storage_upload_tickets
    set status='expired'
    where client_id=c.id and status='issued' and expires_at<=now()
    returning resource_idempotency_key
  )
  update public.nxq_client_resource_reservations reservation
  set status='released',released_at=now(),updated_at=now()
  where reservation.client_id=c.id and reservation.resource_key='storage_bytes'
    and reservation.status='reserved'
    and reservation.idempotency_key in (select resource_idempotency_key from expired);
  key_value:='storage-upload:'||encode(extensions.digest(target_bucket_id||':'||target_object_path,'sha256'),'hex');
  reserve_result:=public.nxq_reserve_client_resource(c.id,'storage_bytes',target_file_size,key_value,jsonb_build_object('bucket_id',target_bucket_id));
  if not coalesce((reserve_result->>'allowed')::boolean,false) then raise exception 'Upload denied by monthly storage limit.'; end if;
  insert into public.nxq_storage_upload_tickets(client_id,bucket_id,object_path,file_size,mime_type,resource_idempotency_key)
  values(c.id,target_bucket_id,target_object_path,target_file_size,btrim(target_mime_type),key_value)
  on conflict(bucket_id,object_path) do update set expires_at=now()+interval '15 minutes'
    where public.nxq_storage_upload_tickets.client_id=c.id and public.nxq_storage_upload_tickets.status='issued'
  returning id into ticket_id;
  if ticket_id is null then raise exception 'Upload ticket could not be issued.'; end if;
  return jsonb_build_object('ok',true,'ticket_id',ticket_id,'expires_in_seconds',900);
end; $$;

revoke all on function public.nxq_authorize_storage_upload(text,text,bigint,text) from public,anon,authenticated,service_role;
grant execute on function public.nxq_authorize_storage_upload(text,text,bigint,text) to authenticated;

-- (1b) The monthly storage allowance comes from a per-client policy that migration 246 only creates once a client is approved. Without a policy the
-- authorization above fails with "No server-side resource policy is configured", so a paid client in setup could still not upload. This redefines the
-- trigger function so a PAID client in setup also gets their policy (the same tier policy an approved client of that tier gets), and the trigger now
-- also watches billing_status. The new branch never raises: if seeding is not possible (no price, no economic policy) the client's own flow
-- (for example submitting their setup, which changes status) must not break; they simply cannot upload yet.
create or replace function public.nxq_sync_client_resource_policy()
returns trigger language plpgsql security definer set search_path=public as $$
declare billing_only boolean := false;
begin
  -- Watching billing_status is only for the new "paid client in setup" branch. For an approved client a billing-only change (past_due, cancelled, a Stripe
  -- webhook, the owner freezing a non-payer) must behave exactly as in migration 246: no re-seeding, no overwritten hand-tuned limits, and nothing that could raise
  -- and roll the billing change back.
  if tg_op = 'UPDATE' then
    billing_only := old.billing_status is distinct from new.billing_status
      and old.status is not distinct from new.status
      and old.product_family_id is not distinct from new.product_family_id
      and old.product_tier_id is not distinct from new.product_tier_id
      and old.monthly_price is not distinct from new.monthly_price
      and old.qa_only is not distinct from new.qa_only;
  end if;
  if new.product_family_id is not null and new.product_tier_id is not null
     and (new.qa_only or coalesce(new.monthly_price,0)>0) then
    if new.status::text in ('approved','active','overdue') then
      if billing_only then
        return new;
      end if;
      if auth.role()<>'service_role' and not public.is_nxq_owner() then
        raise exception 'Only an owner or protected service may seed resource policies.';
      end if;
      perform public.nxq_seed_client_resource_policies_internal(new.id);
    elsif new.status::text in ('lead','intake_received','needs_owner_review')
          and new.billing_status::text in ('active','past_due') then
      begin
        perform public.nxq_seed_client_resource_policies_internal(new.id);
      exception when others then
        raise warning 'Resource policy was not seeded for client %: %', new.id, sqlerrm;
      end;
    end if;
  end if;
  return new;
end; $$;
revoke all on function public.nxq_sync_client_resource_policy() from public,anon,authenticated,service_role;
drop trigger if exists nxq_sync_client_resource_policy on public.clients;
create trigger nxq_sync_client_resource_policy after insert or update of product_family_id,product_tier_id,monthly_price,qa_only,status,billing_status
on public.clients for each row execute function public.nxq_sync_client_resource_policy();

-- (2)-(4) Photo roles and the build-time read.

create table if not exists public.client_site_photos (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  client_file_id uuid not null unique references public.client_files(id) on delete cascade,
  role text not null check (role in ('work', 'site')),
  alt_text text not null default '' check (length(alt_text) <= 160),
  caption text not null default '' check (length(caption) <= 160),
  sort_order integer not null default 0 check (sort_order between 0 and 999),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists client_site_photos_client_idx on public.client_site_photos (client_id, role, sort_order);
alter table public.client_site_photos enable row level security;
revoke all on public.client_site_photos from public, anon, authenticated;

create or replace function public.list_my_site_photos()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  client_row public.clients%rowtype;
begin
  if auth.role() <> 'authenticated' or auth.uid() is null then
    raise exception 'Authenticated client access required.';
  end if;
  select * into client_row from public.clients where auth_user_id = auth.uid();
  if not found then raise exception 'Client account was not found.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'file_id', p.client_file_id,
      'file_name', f.file_name,
      'role', p.role,
      'alt_text', p.alt_text,
      'caption', p.caption,
      'sort_order', p.sort_order,
      'scan_status', coalesce(s.status, 'pending'),
      'released', coalesce(s.quarantine_status, 'restricted') = 'released'
    ) order by p.role, p.sort_order, p.created_at)
    from public.client_site_photos p
    join public.client_files f on f.id = p.client_file_id
    left join public.client_file_security_scans s on s.client_file_id = f.id
    where p.client_id = client_row.id and coalesce(f.status, '') <> 'deleted'
  ), '[]'::jsonb);
end;
$$;

create or replace function public.save_my_site_photo(
  target_file_id uuid,
  target_role text,
  target_alt_text text default '',
  target_caption text default '',
  target_sort_order integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  client_row public.clients%rowtype;
  file_row public.client_files%rowtype;
  role_value text := lower(btrim(coalesce(target_role, '')));
  alt_value text := left(regexp_replace(btrim(coalesce(target_alt_text, '')), '[[:cntrl:]]', ' ', 'g'), 160);
  caption_value text := left(regexp_replace(btrim(coalesce(target_caption, '')), '[[:cntrl:]]', ' ', 'g'), 160);
  order_value integer := coalesce(target_sort_order, 0);
  work_count integer;
  total_count integer;
begin
  if auth.role() <> 'authenticated' or auth.uid() is null then
    raise exception 'Authenticated client access required.';
  end if;
  select * into client_row from public.clients where auth_user_id = auth.uid() for update;
  if not found then raise exception 'Client account was not found.'; end if;
  if client_row.qa_only or client_row.pipeline_stopped_at is not null
     or client_row.status::text in ('denied', 'frozen', 'dormant', 'archived') then
    raise exception 'Client lifecycle does not allow website photos.';
  end if;
  if client_row.billing_status::text not in ('active', 'past_due') then
    raise exception 'Website photos need an active plan.';
  end if;
  if role_value not in ('work', 'site') then
    raise exception 'Choose where the photo goes: work or site.';
  end if;
  if order_value < 0 or order_value > 999 then
    raise exception 'The photo order must be between 0 and 999.';
  end if;
  if position('<' in alt_value || caption_value) > 0 or position('>' in alt_value || caption_value) > 0 then
    raise exception 'Photo descriptions cannot contain the characters < or >.';
  end if;

  select * into file_row from public.client_files
  where id = target_file_id and client_id = client_row.id and bucket_id = 'client-files' and coalesce(status, '') <> 'deleted';
  if not found then raise exception 'That photo was not found in your files.'; end if;
  if lower(coalesce(file_row.file_type, '')) not in ('image/jpeg', 'image/png', 'image/webp') then
    raise exception 'Only JPG, PNG or WebP pictures can be used on your website.';
  end if;

  select count(*) filter (where role = 'work' and client_file_id <> target_file_id), count(*) filter (where client_file_id <> target_file_id)
  into work_count, total_count from public.client_site_photos where client_id = client_row.id;
  if role_value = 'work' and work_count >= 12 then raise exception 'You can show up to 12 photos in Our work.'; end if;
  if total_count >= 24 then raise exception 'You can keep up to 24 website photos.'; end if;

  insert into public.client_site_photos (client_id, client_file_id, role, alt_text, caption, sort_order)
  values (client_row.id, file_row.id, role_value, alt_value, caption_value, order_value)
  on conflict (client_file_id) do update
    set role = excluded.role, alt_text = excluded.alt_text, caption = excluded.caption, sort_order = excluded.sort_order, updated_at = now();
  return jsonb_build_object('ok', true, 'file_id', file_row.id, 'role', role_value);
end;
$$;

create or replace function public.remove_my_site_photo(target_file_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  client_row public.clients%rowtype;
  removed integer;
begin
  if auth.role() <> 'authenticated' or auth.uid() is null then
    raise exception 'Authenticated client access required.';
  end if;
  select * into client_row from public.clients where auth_user_id = auth.uid();
  if not found then raise exception 'Client account was not found.'; end if;
  delete from public.client_site_photos where client_file_id = target_file_id and client_id = client_row.id;
  get diagnostics removed = row_count;
  return jsonb_build_object('ok', true, 'removed', removed > 0);
end;
$$;

create or replace function public.get_site_photos_for_build(target_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service-role access required.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'file_id', p.client_file_id,
      'bucket_id', f.bucket_id,
      'storage_path', f.storage_path,
      'file_name', f.file_name,
      'file_type', lower(f.file_type),
      'file_size', f.file_size,
      'content_sha256', s.content_sha256,
      'role', p.role,
      'alt_text', p.alt_text,
      'caption', p.caption,
      'sort_order', p.sort_order
    ) order by p.role, p.sort_order, p.created_at)
    from public.client_site_photos p
    join public.client_files f on f.id = p.client_file_id
    join public.client_file_security_scans s on s.client_file_id = f.id
    join public.clients c on c.id = p.client_id
    where p.client_id = target_client_id
      and c.status::text in ('approved', 'active', 'overdue') and not coalesce(c.qa_only, false) and c.pipeline_stopped_at is null
      and coalesce(f.status, '') <> 'deleted'
      and f.bucket_id = 'client-files'
      and lower(coalesce(f.file_type, '')) in ('image/jpeg', 'image/png', 'image/webp')
      and s.status = 'clean' and s.quarantine_status = 'released'
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.list_my_site_photos(), public.save_my_site_photo(uuid, text, text, text, integer),
  public.remove_my_site_photo(uuid), public.get_site_photos_for_build(uuid) from public, anon, authenticated, service_role;
grant execute on function public.list_my_site_photos(), public.save_my_site_photo(uuid, text, text, text, integer),
  public.remove_my_site_photo(uuid) to authenticated;
grant execute on function public.get_site_photos_for_build(uuid) to service_role;
