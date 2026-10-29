// Signed-in shopper calls (migration 268). These functions refuse anonymous callers, so they live here and not inside the
// anonymous-facing Public* pages; the pages only call them after a session exists. Argument names are verified against the
// real database functions by the local schema harness.
import { supabase } from "./supabaseClient";
import type { ShopperProfilePayload } from "./shopperAccount";

export type ShopperRpcResult = { data: unknown; error: { message: string } | null };

const unavailable: ShopperRpcResult = { data: null, error: { message: "unavailable" } };

export async function fetchShopperProfile(storeSlug: string): Promise<ShopperRpcResult> {
  if (!supabase) return unavailable;
  return supabase.rpc("get_my_shopper_profile", { store_slug_value: storeSlug });
}

export async function fetchShopperOrders(storeSlug: string): Promise<ShopperRpcResult> {
  if (!supabase) return unavailable;
  return supabase.rpc("list_my_shopper_orders", { store_slug_value: storeSlug });
}

export async function saveShopperProfile(storeSlug: string, payload: ShopperProfilePayload): Promise<ShopperRpcResult> {
  if (!supabase) return unavailable;
  return supabase.rpc("save_my_shopper_profile", { store_slug_value: storeSlug, profile_payload: payload });
}

export async function deleteShopperProfile(storeSlug: string): Promise<ShopperRpcResult> {
  if (!supabase) return unavailable;
  return supabase.rpc("delete_my_shopper_profile", { store_slug_value: storeSlug });
}
