// The ONE switch for the owner's AI Desk "Save to project" mode. It is ON since migration 277 (supabase/migrations/277_ai_desk_build_plans.sql) was APPLIED to staging
// (2026-10-22, run #266) and the prepare-build-plan function was deployed; switched on 2026-10-28. To turn Save to project off again, set it back to null: the panel then works in
// its no-server mode (copy the task, paste the reply, check it) and nothing calls the database functions.
// If Supabase is not configured in the build (no URL/key) it stays null, so nothing calls the database.
import type { AiDeskGateway } from "./aiDeskGateway";
import { createAiDeskGateway } from "./aiDeskSupabaseGateway";
import { supabase } from "./supabaseClient";

export const aiDeskGateway: AiDeskGateway | null = supabase ? createAiDeskGateway(supabase) : null;
