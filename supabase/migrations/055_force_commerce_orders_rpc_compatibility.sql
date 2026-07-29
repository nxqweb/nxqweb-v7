-- Force compatibility between the original Commerce order schema and the newer Orders RPCs.
-- Forward-only and data-preserving.

alter table public.commerce_orders
  add column if not exists currency text,
  add column if not exists total numeric(12,2);

alter table public.commerce_order_items
  add column if not exists variant_title text;

update public.commerce_orders
set currency = coalesce(currency, currency_code, 'USD'),
    total = coalesce(total, grand_total, 0)
where currency is null or total is null;

update public.commerce_order_items
set variant_title = coalesce(variant_title, variant_name)
where variant_title is null;

create or replace function public.sync_commerce_order_compatibility_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.currency_code := coalesce(nullif(new.currency_code, ''), nullif(new.currency, ''), 'USD');
    new.currency := coalesce(nullif(new.currency, ''), new.currency_code, 'USD');

    if new.grand_total is null or (new.grand_total = 0 and coalesce(new.total, 0) <> 0) then
      new.grand_total := coalesce(new.total, 0);
    end if;
    new.total := coalesce(new.total, new.grand_total, 0);
  else
    if new.currency is distinct from old.currency and new.currency is not null then
      new.currency_code := new.currency;
    elsif new.currency_code is distinct from old.currency_code then
      new.currency := new.currency_code;
    end if;

    if new.total is distinct from old.total and new.total is not null then
      new.grand_total := new.total;
    elsif new.grand_total is distinct from old.grand_total then
      new.total := new.grand_total;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists sync_commerce_order_compatibility_columns on public.commerce_orders;
create trigger sync_commerce_order_compatibility_columns
before insert or update on public.commerce_orders
for each row execute function public.sync_commerce_order_compatibility_columns();

create or replace function public.sync_commerce_order_item_compatibility_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.variant_name := coalesce(new.variant_name, new.variant_title);
    new.variant_title := coalesce(new.variant_title, new.variant_name);
  else
    if new.variant_title is distinct from old.variant_title then
      new.variant_name := new.variant_title;
    elsif new.variant_name is distinct from old.variant_name then
      new.variant_title := new.variant_name;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists sync_commerce_order_item_compatibility_columns on public.commerce_order_items;
create trigger sync_commerce_order_item_compatibility_columns
before insert or update on public.commerce_order_items
for each row execute function public.sync_commerce_order_item_compatibility_columns();

-- Ensure the API notices the repaired columns and refreshed functions immediately.
notify pgrst, 'reload schema';
