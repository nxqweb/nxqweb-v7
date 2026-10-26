// Gateway for the two Booking pages: calls the functions of migration 283 (supabase/migrations/283_booking_requests.sql). It is only used when the switches in src/lib/bookingConfig.ts
// are set; until 283 is applied (and the product decisions are made) they stay null and nothing calls these functions. scripts/test-booking.mjs checks these exact call names and argument names against the SQL.
import type { SupabaseClient } from "@supabase/supabase-js";
import { pageFromRow, requestRowsFromRows, setupFromRow, type OwnerBookingGateway, type PublicBookingGateway } from "./bookingGateway";

function check<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

export function createPublicBookingGateway(client: SupabaseClient): PublicBookingGateway {
  return {
    async loadPage(slug) { return pageFromRow(check(await client.rpc("get_public_booking_page", { slug_value: slug }))); },
    async submit(input) {
      const data = check(await client.rpc("submit_public_booking_request", {
        slug_value: input.slug, service_key_value: input.serviceKey, requested_start_value: input.startIso, contact_name_value: input.name,
        contact_email_value: input.email || null, contact_phone_value: input.phone || null, notes_value: input.notes || null,
        idempotency_key_value: input.idempotencyKey, website_value: input.website || null,
      })) as { request_code?: string; status?: string } | null;
      return { requestCode: String(data?.request_code ?? ""), status: String(data?.status ?? "requested") };
    },
  };
}

export function createOwnerBookingGateway(client: SupabaseClient): OwnerBookingGateway {
  return {
    async load() { return setupFromRow(check(await client.rpc("get_my_booking_setup"))); },
    async ensure(timezone) { return setupFromRow(check(await client.rpc("ensure_my_booking_workspace", { timezone_value: timezone }))); },
    async saveSettings(input) {
      return setupFromRow(check(await client.rpc("save_my_booking_settings", {
        display_name_value: input.displayName || null, intro_value: input.intro, timezone_value: input.timezone, minimum_lead_minutes_value: input.minimumLeadMinutes,
        maximum_advance_days_value: input.maximumAdvanceDays, cancellation_policy_value: input.cancellationPolicy, public_slug_value: input.publicSlug || null,
      })));
    },
    async saveService(input) { return setupFromRow(check(await client.rpc("save_my_booking_service", { service_key_value: input.serviceKey, name_value: input.name, duration_minutes_value: input.durationMinutes, active_value: input.active }))); },
    async saveHours(hours) { return setupFromRow(check(await client.rpc("save_my_booking_hours", { hours_value: hours.map((h) => ({ weekday: h.weekday, start: h.start, end: h.end })) }))); },
    async setPublic(enabled) { return setupFromRow(check(await client.rpc("set_my_booking_public", { enabled_value: enabled }))); },
    async listRequests(status) { return requestRowsFromRows(check(await client.rpc("list_my_booking_requests", { status_value: status || null, limit_value: 200 }))); },
    async updateRequest(id, status, note) { check(await client.rpc("update_my_booking_request", { request_id_value: id, status_value: status, owner_note_value: note })); },
    async deleteRequest(id) { check(await client.rpc("delete_my_booking_request", { request_id_value: id })); },
  };
}
