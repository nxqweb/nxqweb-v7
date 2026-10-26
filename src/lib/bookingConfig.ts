// The switches for the Booking pages ("Appointment requests", request-only). Both stay null until migration 283 (supabase/migrations/283_booking_requests.sql) has been APPLIED
// AND the owner has decided which plans include Booking, how long request data is kept, and whether a business may mark a request "confirmed". Then set them to
// createOwnerBookingGateway(supabase) / createPublicBookingGateway(supabase) from ./bookingSupabaseGateway (steps in docs/drafts/ui/README.md).
// While they are null: /client/booking and /book/<name> say the feature is not open yet, the portal shows no Booking card, and nothing calls the database.
import type { OwnerBookingGateway, PublicBookingGateway } from "./bookingGateway";

export const ownerBookingGateway: OwnerBookingGateway | null = null;
export const publicBookingGateway: PublicBookingGateway | null = null;
