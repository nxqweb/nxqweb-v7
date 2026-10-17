-- DRAFT 10: close two cross-tenant write holes found by an independent security review (2026-10-17). LOCAL ONLY, NOT promoted, NOT applied.
--
-- HOLE 1 (medium-high), the Commerce tables (migration 036): signed-in clients were granted insert/update/delete on commerce_storefronts, categories, products,
-- product_variants, inventory_movements, customers, carts, cart_items, orders and order_items. The row-level policy only checks that the row's OWN client_id is the
-- caller's; the storefront_id / product_id / category_id columns are plain foreign keys that may point at ANOTHER client's rows. So any signed-in client could call the
-- data API directly with their own login, put a product (and variant, with a price and stock) into a VICTIM's storefront (the victim's storefront id is returned to
-- anyone by a public function), have it listed on the victim's live store, and have shoppers' orders for it land in the victim's order list. The same direct access also
-- lets a client write commerce_storefronts themselves (for example status = 'active' without the owner's launch approval).
--
-- HOLE 2 (low-medium), data_subject_requests and privacy_consents (migrations 140 and 135): clients may insert, and the insert policy accepts a row if EITHER the
-- account id OR the client id is the caller's, so a caller can name another client in the other column (and get that client's profile data written into an export result,
-- or withdraw another account's consents).
--
-- WHY THIS FIX IS SAFE: the app never writes any of these tables directly (every write goes through SECURITY DEFINER functions such as the save_my_* functions, the
-- public checkout and the privacy request functions, which run with the function owner's rights, not the caller's; the Edge functions use the service role). A search of
-- src/ found no direct insert/update/delete on these tables. The pages only READ them, and select grants are left exactly as they are. Row-level policies are left in place
-- (harmless once the grants are gone, and a second layer if a grant ever comes back).
--
-- Promotion would be migration 274 (or the next free number) and is an owner decision: it adds a pending migration to the Oct 22 plan.

revoke insert, update, delete on table public.commerce_storefronts from authenticated;
revoke insert, update, delete on table public.commerce_categories from authenticated;
revoke insert, update, delete on table public.commerce_products from authenticated;
revoke insert, update, delete on table public.commerce_product_variants from authenticated;
revoke insert, update, delete on table public.commerce_inventory_movements from authenticated;
revoke insert, update, delete on table public.commerce_customers from authenticated;
revoke insert, update, delete on table public.commerce_carts from authenticated;
revoke insert, update, delete on table public.commerce_cart_items from authenticated;
revoke insert, update, delete on table public.commerce_orders from authenticated;
revoke insert, update, delete on table public.commerce_order_items from authenticated;

revoke insert on table public.data_subject_requests from authenticated;
revoke insert on table public.privacy_consents from authenticated;
