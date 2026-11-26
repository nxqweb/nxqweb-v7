// The ONE switch for the pre-launch waiting list. DRAFT (docs/drafts/waitlist/); the final home is src/lib/waitlistConfig.ts. It is OFF (null): the sign-up page shows
// "not open yet" and the owner page explains the list is off; nothing calls the database or the function.
// TO TURN ON (each step needs the owner's go-ahead, see docs/drafts/waitlist/README.md): apply the waitlist migration, deploy join-waitlist, set NXQ_WAITLIST_ENABLED
// and NXQ_WAITLIST_ALLOWED_ORIGINS, have an email sender ready, then change `null` below to `supabase ? createWaitlistGateway(supabase) : null`, and import the two
// names (`createWaitlistGateway` from "./waitlistSupabaseGateway" and `supabase` from "./supabaseClient").
import type { WaitlistGateway } from "./waitlist";

export const waitlistGateway: WaitlistGateway | null = null;
