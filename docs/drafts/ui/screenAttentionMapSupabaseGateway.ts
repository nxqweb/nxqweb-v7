// DRAFT gateway for the screen attention map. It calls current_client_screen_attention_map from draft migration 13, which is not in supabase/migrations yet, so the repo check
// would reject a .rpc() call to it inside src/. After migration 13 is promoted and applied: move this file to src/lib/, then set the switch in src/lib/screenAttentionMapConfig.ts.
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
