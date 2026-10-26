// The ONE switch for the "Screen attention map" page. It stays null until migration 279 (supabase/migrations/279_screen_attention_map.sql) has been APPLIED;
// then set this to createScreenAttentionGateway(supabase) from ./screenAttentionMapSupabaseGateway.
// While it is null the page says it is not switched on and nothing calls the new database function.
import type { ScreenAttentionGateway } from "./screenAttentionMap";

export const screenAttentionGateway: ScreenAttentionGateway | null = null;
