// The switch for the Members page (Membership v1, track only). It stays null until migration 284 (supabase/migrations/284_membership_tracking.sql) has been APPLIED and the owner
// has decided which plans include it. Then set it to createOwnerMembershipGateway(supabase) from ./membershipSupabaseGateway. Members-only product ENFORCEMENT is not part of 284.
// While it is null: /client/members says the feature is not open yet, the portal shows no Members card, and nothing calls the database.
import type { OwnerMembershipGateway } from "./membershipGateway";

export const ownerMembershipGateway: OwnerMembershipGateway | null = null;
