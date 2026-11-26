// The switch for the Members page (Membership v1, track only). It is ON since migration 284 (supabase/migrations/284_membership_tracking.sql) was APPLIED to staging on 2026-10-26
// (run #272) and the owner decided on 2026-10-27 to launch it for Commerce stores (the functions need a storefront, so other clients get a plain message). Members-only product
// ENFORCEMENT is not part of 284. To turn it off again set it to null. If Supabase is not configured in the build (no URL/key) it stays null, so nothing calls the database.
import type { OwnerMembershipGateway } from "./membershipGateway";
import { createOwnerMembershipGateway } from "./membershipSupabaseGateway";
import { supabase } from "./supabaseClient";

export const ownerMembershipGateway: OwnerMembershipGateway | null = supabase ? createOwnerMembershipGateway(supabase) : null;
