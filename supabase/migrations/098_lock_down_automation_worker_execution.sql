-- Lock automation internals to trusted backend execution only.
-- pg_cron runs these as the database scheduler role; ordinary authenticated clients cannot invoke them.

revoke all
on function public.enqueue_automation_job(uuid, uuid, text, text, jsonb, timestamptz, integer)
from authenticated;

revoke all
on function public.run_automation_worker(text)
from authenticated;

revoke all
on function public.enqueue_automation_job(uuid, uuid, text, text, jsonb, timestamptz, integer)
from public, anon;

revoke all
on function public.run_automation_worker(text)
from public, anon;
