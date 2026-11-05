// The real connection for the owner's AI Desk panel (promoted from docs/drafts/ui with migration 277). It is NOT used anywhere until the one switch in
// src/lib/aiDeskConfig.ts is set, which happens only after migration 277 has been applied to the database (docs/AI_DESK_KIT.md, "Switching it on").
// scripts/test-ai-desk-gateway.mjs checks these exact call names and argument names against the SQL.
import type { SupabaseClient } from "@supabase/supabase-js";
import { deskStatusFromRow, type AiDeskGateway } from "./aiDeskGateway";

function check<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

export function createAiDeskGateway(client: SupabaseClient): AiDeskGateway {
  return {
    async getStatus(clientId) { return deskStatusFromRow(check(await client.rpc("get_ai_desk_status", { target_client_id: clientId }))); },
    async save(clientId, answer) { check(await client.rpc("save_ai_desk_build_plan", { target_client_id: clientId, desk_result: answer })); },
  };
}
