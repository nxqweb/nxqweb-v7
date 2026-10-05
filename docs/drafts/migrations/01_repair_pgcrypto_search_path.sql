-- DRAFT (not applied). Repairs a suspected runtime failure: these functions pin search_path to public
-- but call pgcrypto functions without a schema prefix. Where pgcrypto lives in the "extensions" schema
-- (the Supabase default), the calls cannot be resolved. Setting the search_path to "public, extensions"
-- works wherever pgcrypto is installed. Only the setting changes: no body, grant, owner or signature.
alter function public.nxq_flag_referral_payment_reversal(uuid, text, text) set search_path = public, extensions;
alter function public.nxq_queue_sales_delivery(uuid, timestamptz, text) set search_path = public, extensions;
alter function public.nxq_record_sales_delivery_event(uuid, text, text, text) set search_path = public, extensions;
alter function public.nxq_reserve_sales_delivery(uuid, boolean) set search_path = public, extensions;
alter function public.owner_create_fictional_sales_source_run(text, text, integer) set search_path = public, extensions;
alter function public.owner_record_sales_reply(uuid, text, text, numeric) set search_path = public, extensions;
alter function public.submit_public_commerce_customer_request(text, jsonb) set search_path = public, extensions;
