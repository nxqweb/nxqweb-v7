// The ONE switch for the "Screen attention map" page. It stays null until draft migration 13 (docs/drafts/migrations/13_screen_attention_map.sql) has been promoted to
// supabase/migrations and APPLIED; then move docs/drafts/ui/screenAttentionMapSupabaseGateway.ts into src/lib and set this to createScreenAttentionGateway(supabase).
// While it is null the page says it is not switched on and nothing calls the new database function.
import type { ScreenAttentionGateway } from "./screenAttentionMap";

export const screenAttentionGateway: ScreenAttentionGateway | null = null;
