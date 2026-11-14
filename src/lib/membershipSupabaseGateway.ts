// Gateway for the Members page: calls the functions of migration 284 (supabase/migrations/284_membership_tracking.sql). It is only used when the switch in src/lib/membershipConfig.ts
// is set; until 284 is applied (and the product decisions are made) it stays null and nothing calls these functions.
import type { SupabaseClient } from "@supabase/supabase-js";
import { membershipFromRow, type OwnerMembershipGateway } from "./membershipGateway";

function check<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

export function createOwnerMembershipGateway(client: SupabaseClient): OwnerMembershipGateway {
  return {
    async load() { return membershipFromRow(check(await client.rpc("list_my_membership"))); },
    async saveTier(input) {
      check(await client.rpc("save_my_member_tier", { tier_id_value: input.id, name_value: input.name, perks_value: input.perks || null, active_value: input.active }));
    },
    async saveMember(input) {
      check(await client.rpc("save_my_member", {
        member_id_value: input.id, email_value: input.email, name_value: input.fullName || null, phone_value: input.phone || null,
        tier_id_value: input.tierId, status_value: input.status, renews_on_value: input.renewsOn || null, notes_value: input.notes || null,
      }));
    },
    async removeMember(id) { check(await client.rpc("remove_my_member", { member_id_value: id })); },
  };
}
