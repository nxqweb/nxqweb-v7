// How the Booking pages talk to the database. The pages only know these small interfaces, so they can be built and tested before the database functions exist.
// The real connections (src/lib/bookingSupabaseGateway.ts) are switched on in src/lib/bookingConfig.ts once migration 283 is applied.
import type { HoursPeriod } from "./bookingTime";

export type BookingService = { serviceKey: string; name: string; durationMinutes: number; active: boolean };
export type BookingPage = {
  displayName: string; intro: string; timezone: string; minimumLeadMinutes: number; maximumAdvanceDays: number; cancellationPolicy: string;
  services: BookingService[]; hours: HoursPeriod[];
};
export type BookingSetup = BookingPage & { hasWorkspace: boolean; status: string; publicSlug: string; publicEnabled: boolean; newRequests: number };
export type BookingRequestRow = {
  id: string; requestCode: string; status: string; serviceName: string; requestedStartAt: string; timezone: string;
  contactName: string; contactEmail: string; contactPhone: string; notes: string; ownerNote: string; createdAt: string;
};
export type BookingRequestStatus = "requested" | "needs_review" | "declined" | "cancelled";

export type PublicBookingGateway = {
  loadPage: (slug: string) => Promise<BookingPage | null>;
  submit: (input: { slug: string; serviceKey: string; startIso: string; name: string; email: string; phone: string; notes: string; idempotencyKey: string; website: string }) => Promise<{ requestCode: string; status: string }>;
};
export type OwnerBookingGateway = {
  load: () => Promise<BookingSetup>;
  ensure: (timezone: string) => Promise<BookingSetup>;
  saveSettings: (input: { displayName: string; intro: string; timezone: string; minimumLeadMinutes: number; maximumAdvanceDays: number; cancellationPolicy: string; publicSlug: string }) => Promise<BookingSetup>;
  saveService: (input: { serviceKey: string; name: string; durationMinutes: number; active: boolean }) => Promise<BookingSetup>;
  saveHours: (hours: HoursPeriod[]) => Promise<BookingSetup>;
  setPublic: (enabled: boolean) => Promise<BookingSetup>;
  listRequests: (status: BookingRequestStatus | "") => Promise<BookingRequestRow[]>;
  updateRequest: (id: string, status: BookingRequestStatus, note: string) => Promise<void>;
  deleteRequest: (id: string) => Promise<void>;
};

const text = (value: unknown) => (typeof value === "string" ? value : "");
const whole = (value: unknown, fallback: number) => { const n = Number(value); return Number.isFinite(n) ? Math.trunc(n) : fallback; };
const record = (value: unknown): Record<string, unknown> => (value && typeof value === "object" ? (value as Record<string, unknown>) : {});

export function servicesFromRows(rows: unknown): BookingService[] {
  return (Array.isArray(rows) ? rows : []).map(record).filter((r) => text(r.service_key) && text(r.name))
    .map((r) => ({ serviceKey: text(r.service_key), name: text(r.name), durationMinutes: whole(r.duration_minutes, 0), active: r.active !== false }));
}
export function hoursFromRows(rows: unknown): HoursPeriod[] {
  return (Array.isArray(rows) ? rows : []).map(record)
    .map((r) => ({ weekday: whole(r.weekday, -1), start: text(r.start), end: text(r.end) }))
    .filter((h) => h.weekday >= 0 && h.weekday <= 6 && /^\d{2}:\d{2}$/.test(h.start) && /^\d{2}:\d{2}$/.test(h.end));
}
export function pageFromRow(row: unknown): BookingPage | null {
  const r = record(row);
  if (!text(r.display_name)) return null;
  return {
    displayName: text(r.display_name), intro: text(r.intro), timezone: text(r.timezone), minimumLeadMinutes: whole(r.minimum_lead_minutes, 120), maximumAdvanceDays: whole(r.maximum_advance_days, 90),
    cancellationPolicy: text(r.cancellation_policy), services: servicesFromRows(r.services), hours: hoursFromRows(r.hours),
  };
}
export const emptyBookingSetup: BookingSetup = { hasWorkspace: false, status: "", publicSlug: "", publicEnabled: false, newRequests: 0, displayName: "", intro: "", timezone: "America/Los_Angeles", minimumLeadMinutes: 120, maximumAdvanceDays: 90, cancellationPolicy: "", services: [], hours: [] };
export function setupFromRow(row: unknown): BookingSetup {
  const r = record(row);
  if (r.has_workspace !== true) return emptyBookingSetup;
  return {
    hasWorkspace: true, status: text(r.status), publicSlug: text(r.public_slug), publicEnabled: r.public_enabled === true, newRequests: whole(r.new_requests, 0),
    displayName: text(r.display_name), intro: text(r.intro), timezone: text(r.timezone) || "America/Los_Angeles", minimumLeadMinutes: whole(r.minimum_lead_minutes, 120), maximumAdvanceDays: whole(r.maximum_advance_days, 90),
    cancellationPolicy: text(r.cancellation_policy), services: servicesFromRows(r.services), hours: hoursFromRows(r.hours),
  };
}
export function requestRowsFromRows(rows: unknown): BookingRequestRow[] {
  return (Array.isArray(rows) ? rows : []).map(record).filter((r) => text(r.id)).map((r) => ({
    id: text(r.id), requestCode: text(r.request_code), status: text(r.status), serviceName: text(r.service_name), requestedStartAt: text(r.requested_start_at), timezone: text(r.timezone),
    contactName: text(r.contact_name), contactEmail: text(r.contact_email), contactPhone: text(r.contact_phone), notes: text(r.notes), ownerNote: text(r.owner_note), createdAt: text(r.created_at),
  }));
}

export const bookingStatusLabel: Record<string, string> = { requested: "New", needs_review: "In progress", declined: "Declined", cancelled: "Cancelled" };

// Owner-side messages in plain words. Unknown messages never leak raw database text.
export function friendlyOwnerBookingError(message: string | null | undefined): string {
  const t = String(message ?? "");
  if (/website project is not set up/i.test(t)) return "Your website project is not set up yet, so booking cannot start. Please contact us.";
  if (/already taken/i.test(t)) return "That page address is already taken. Choose another.";
  if (/reserved/i.test(t)) return "That page address is reserved. Choose another.";
  if (/page address must be/i.test(t)) return "The page address must be 3 to 60 letters, numbers and single dashes.";
  const missing = /Choose a page address first|Add a page name first|Add at least one service first|Add your opening hours first/i.exec(t);
  if (missing) return `${missing[0]}, then turn your booking page on.`;
  if (/cannot overlap|end after it starts|day, a start and an end|up to 28/i.test(t)) return "Please check your opening hours: each period needs a start before its end, and periods on one day cannot overlap.";
  if (/time zone/i.test(t)) return "Choose a valid time zone.";
  if (/Request not found/i.test(t)) return "That request could not be found. It may already have been removed.";
  if (/Client workspace not found/i.test(t)) return "We could not find your workspace. Please sign in again.";
  if (/< or >/i.test(t)) return "Please remove any < or > characters and keep the text within the limits.";
  if (/5-minute mark/i.test(t)) return "Please use opening times on a 5-minute mark, such as 09:00 or 09:05.";
  if (/not available for your account/i.test(t)) return "Booking is not available for your account right now. Please contact us.";
  if (/\d+ (to \d+ )?characters|characters or fewer/i.test(t)) return "That text is too long or too short. Please check the limits shown next to the field.";
  return "We could not save that right now. Nothing was changed. Please try again in a moment.";
}
