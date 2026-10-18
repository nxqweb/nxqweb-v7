// The ONE switch for the owner's AI Desk "Save to project" mode. It stays null until migration 277 (supabase/migrations/277_ai_desk_build_plans.sql) has been APPLIED
// to the database; then set it to createAiDeskGateway(supabase) from ./aiDeskSupabaseGateway (docs/AI_DESK_KIT.md, "Switching it on").
// While it is null the AI Desk panel works in its no-server mode (copy the task, paste the reply, check it) and nothing calls the new database functions.
import type { AiDeskGateway } from "./aiDeskGateway";

export const aiDeskGateway: AiDeskGateway | null = null;
