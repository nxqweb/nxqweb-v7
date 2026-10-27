// The switches for the Booking pages ("Appointment requests", request-only). They are ON since migration 283 (supabase/migrations/283_booking_requests.sql) was APPLIED to staging on
// 2026-10-26 (run #272) and the owner decided on 2026-10-27: Booking is for clients with a website project in good standing, it stays request-only (nothing is confirmed by hand), and
// requests are kept until the business deletes them. To turn Booking off again set both to null. If Supabase is not configured in the build (no URL/key) they stay null, so nothing
// calls the database. While null: /client/booking and /book/<name> say the feature is not open yet and the portal shows no Booking card.
import type { OwnerBookingGateway, PublicBookingGateway } from "./bookingGateway";
import { createOwnerBookingGateway, createPublicBookingGateway } from "./bookingSupabaseGateway";
import { supabase } from "./supabaseClient";

export const ownerBookingGateway: OwnerBookingGateway | null = supabase ? createOwnerBookingGateway(supabase) : null;
export const publicBookingGateway: PublicBookingGateway | null = supabase ? createPublicBookingGateway(supabase) : null;
