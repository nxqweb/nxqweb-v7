-- Wave 12: complete client change-request evidence sync with preview/live URLs and revision state.

create or replace function public.sync_change_request_from_website_run()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  target_status text;
  preview_url_value text;
  published_url_value text;
  target_change_id uuid;
begin
  if tg_op='UPDATE' and old.status is not distinct from new.status then
    return new;
  end if;

  target_status := case new.status
    when 'preview_ready' then 'preview_ready'
    when 'published' then 'published'
    when 'failed' then 'failed'
    when 'cancelled' then 'failed'
    else null
  end;
  if target_status is null then return new; end if;

  select r.id into target_change_id
  from public.website_change_requests r
  where r.client_id=new.client_id
    and r.project_id=new.project_id
    and r.automation_plan->>'website_automation_run_id'=new.id::text
    and r.status not in ('published','cancelled')
  order by r.created_at desc
  limit 1;

  if target_change_id is null then return new; end if;

  if target_status='preview_ready' then
    select nullif(s.output->>'preview_url','') into preview_url_value
    from public.website_automation_steps s
    where s.run_id=new.id and s.step_key='client_review' and s.status='completed'
    limit 1;
    if preview_url_value is not null and preview_url_value not like 'https://%' then preview_url_value:=null; end if;
  end if;

  if target_status='published' then
    select nullif(d.production_url,'') into published_url_value
    from public.project_deployment_configs d
    where d.project_id=new.project_id and d.client_id=new.client_id
    limit 1;
    if published_url_value is not null and published_url_value not like 'https://%' then published_url_value:=null; end if;
  end if;

  update public.website_change_requests r
  set status=target_status,
      preview_url=case when target_status='preview_ready' then preview_url_value else r.preview_url end,
      published_url=case when target_status='published' then published_url_value else r.published_url end,
      completed_at=case when target_status in ('published','failed') then now() else r.completed_at end,
      last_error=case
        when target_status='failed' then coalesce(r.last_error,'Website automation run failed or was cancelled before the requested change could publish.')
        else null
      end,
      automation_plan=coalesce(r.automation_plan,'{}'::jsonb)||jsonb_build_object(
        'website_automation_run_id',new.id,
        'run_status',new.status,
        'source_branch',new.source_branch,
        'preview_url',coalesce(preview_url_value,r.preview_url),
        'published_url',coalesce(published_url_value,r.published_url),
        'synced_at',now()
      ),
      updated_at=now()
  where r.id=target_change_id;

  if target_status='preview_ready' then
    update public.website_content_revisions
    set state='preview'
    where change_request_id=target_change_id and state='draft';
  elsif target_status='published' then
    update public.website_content_revisions
    set state='published'
    where change_request_id=target_change_id and state in ('draft','preview');
  end if;

  return new;
end;
$$;

revoke all on function public.sync_change_request_from_website_run() from public,anon,authenticated;

comment on function public.sync_change_request_from_website_run() is 'Synchronizes exact bound website change requests with verified preview/live URLs, terminal timestamps, failure state, and linked revision lifecycle.';
