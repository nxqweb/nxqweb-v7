-- Deterministic first-pass lead classification.
-- This never silently rejects a human lead; spam-like signals are recorded as evidence only.

create or replace function public.classify_business_lead_baseline()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  combined text := lower(coalesce(new.contact_name,'') || ' ' || coalesce(new.contact_email,'') || ' ' || coalesce(new.message,'') || ' ' || coalesce(new.service_key,''));
  spam_score integer := 0;
  inferred_urgency text := coalesce(new.urgency,'normal');
  intent text := 'general_inquiry';
begin
  if combined ~ '(viagra|casino|crypto investment|guest post|backlinks? for sale|seo package|click here|telegram)' then spam_score := spam_score + 65; end if;
  if combined ~ '(http://|https://)' then spam_score := spam_score + 15; end if;
  if length(coalesce(new.message,'')) > 0 and length(coalesce(new.message,'')) < 8 then spam_score := spam_score + 10; end if;

  if combined ~ '(fire|gas leak|electrical fire|immediate danger|life safety)' then inferred_urgency := 'emergency';
  elsif combined ~ '(emergency|urgent|asap|storm damage|flood|leak|no heat|no ac|today)' and inferred_urgency <> 'emergency' then inferred_urgency := 'urgent';
  end if;

  if combined ~ '(quote|estimate|price|cost|how much)' then intent := 'quote_request';
  elsif combined ~ '(book|schedule|appointment|availability)' then intent := 'booking_request';
  elsif combined ~ '(repair|broken|not working|damage|problem)' then intent := 'service_problem';
  elsif combined ~ '(commercial|business|property manager|facility)' then intent := 'commercial_inquiry';
  end if;

  new.urgency := inferred_urgency;
  new.ai_classification := coalesce(new.ai_classification,'{}'::jsonb) || jsonb_build_object(
    'baseline_classifier','nxq-lead-baseline-v1',
    'intent',intent,
    'spam_risk_score',least(100,spam_score),
    'spam_risk',case when spam_score >= 70 then 'high' when spam_score >= 35 then 'medium' else 'low' end,
    'auto_rejected',false,
    'classified_at',now()
  );

  if inferred_urgency in ('urgent','emergency') then
    new.lead_score := greatest(new.lead_score, case when inferred_urgency='emergency' then 90 else 75 end);
  end if;

  return new;
end;
$$;

drop trigger if exists classify_business_lead_baseline on public.client_leads;
create trigger classify_business_lead_baseline
before insert or update of contact_name,contact_email,message,service_key,urgency
on public.client_leads
for each row execute function public.classify_business_lead_baseline();

revoke all on function public.classify_business_lead_baseline() from public, anon, authenticated;

comment on function public.classify_business_lead_baseline() is
  'Deterministic lead intent/urgency/spam-risk enrichment. It records spam evidence but does not silently reject a human lead.';
