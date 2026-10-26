// The ONE switch for the "Screen attention map" page. It is ON since migration 279 (supabase/migrations/279_screen_attention_map.sql) was APPLIED to staging on 2026-10-26 (run #269).
// To turn the page and its portal card off again, set it back to null. If Supabase is not configured in the build (no URL/key) it stays null, so nothing calls the database.
import type { ScreenAttentionGateway } from "./screenAttentionMap";
import { supabase } from "./supabaseClient";
import { createScreenAttentionGateway } from "./screenAttentionMapSupabaseGateway";

export const screenAttentionGateway: ScreenAttentionGateway | null = supabase ? createScreenAttentionGateway(supabase) : null;
