-- Repairs a runtime failure class: these functions pin search_path to public but call pgcrypto
-- functions (digest, gen_random_bytes) without a schema prefix. On this project pgcrypto is installed in
-- the "extensions" schema (confirmed on nxqweb-staging), so the unqualified calls cannot be resolved
-- when those code paths run. Adding "extensions" to the pinned search_path fixes it wherever pgcrypto
-- is installed. This changes only each function's search_path setting: no body, signature, owner or
-- grant changes. "extensions" is not writable by application roles, so it is safe on SECURITY DEFINER.
-- Covered by scripts/sql/local-full-schema/regression/257_repair_pgcrypto_search_path.test.sql.
alter function public.nxq_flag_referral_payment_reversal(uuid, text, text) set search_path = public, extensions;
alter function public.nxq_queue_sales_delivery(uuid, timestamptz, text) set search_path = public, extensions;
alter function public.nxq_record_sales_delivery_event(uuid, text, text, text) set search_path = public, extensions;
alter function public.nxq_reserve_sales_delivery(uuid, boolean) set search_path = public, extensions;
alter function public.owner_create_fictional_sales_source_run(text, text, integer) set search_path = public, extensions;
alter function public.owner_record_sales_reply(uuid, text, text, numeric) set search_path = public, extensions;
alter function public.submit_public_commerce_customer_request(text, jsonb) set search_path = public, extensions;
