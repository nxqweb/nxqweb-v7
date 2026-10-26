// Gateway for the screen attention map: calls current_client_screen_attention_map from migration 279 (supabase/migrations/279_screen_attention_map.sql). It is only used when the ONE switch
// in src/lib/screenAttentionMapConfig.ts is set; until 279 is applied that switch stays null and nothing calls the function.
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseAttentionMap, type ScreenAttentionGateway } from "./screenAttentionMap";

export function createScreenAttentionGateway(supabase: SupabaseClient): ScreenAttentionGateway {
  return {
    async load(page, days) {
      const result = await supabase.rpc("current_client_screen_attention_map", { target_page_path: page, target_days: days });
      if (result.error) throw new Error(result.error.message);
      return parseAttentionMap(result.data);
    },
  };
}
