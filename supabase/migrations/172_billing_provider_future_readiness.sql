-- Future online billing adapter readiness. This is intentionally non-required until online billing is enabled.
insert into public.nxq_provider_connections(provider_key,provider_category,scope_type,status,capabilities,required_secret_names,config)
values('billing_adapter','payments','global','not_configured',array['normalized_payment_events','idempotent_event_ingest','payment_restore','past_due_start'],array['NXQ_BILLING_ADAPTER_TOKEN'],jsonb_build_object('ingest_function','ingest-billing-provider-event','auto_freeze',false,'activation_mode','future'))
on conflict(provider_key,scope_type,scope_id) do update set capabilities=excluded.capabilities,required_secret_names=excluded.required_secret_names,config=excluded.config,updated_at=now();

insert into public.launch_readiness_checks(check_key,category,title,required,status,evidence)
values('billing_provider_hook_ready','providers','Online billing provider adapter connected',false,'not_applicable',jsonb_build_object('reason','Online billing intentionally not required for current launch mode.','manual_billing_supported',true))
on conflict(check_key) do update set required=false;

comment on table public.billing_provider_events is 'Future provider-neutral billing event ledger; current launch may continue using manual billing while this optional provider hook remains not_applicable.';