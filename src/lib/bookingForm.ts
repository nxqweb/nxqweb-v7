// Booking request form: the checks mirror the database rules (draft 06_booking_requests) so a visitor gets a friendly message before anything is sent.
// The database applies the same rules again, and decides everything that matters.

export type BookingRequestInput = { serviceKey: string; startIso: string; name: string; email: string; phone: string; notes: string };
export type BookingFieldErrors = Partial<Record<"service" | "time" | "name" | "contact" | "email" | "phone" | "notes", string>>;

const emailPattern = /^[a-z0-9._+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
const phonePattern = /^[0-9+()\-.\s]+$/;
export const maxNotesLength = 1000;

export function checkBookingRequest(input: BookingRequestInput): BookingFieldErrors {
  const errors: BookingFieldErrors = {};
  const name = input.name.replace(/\s+/g, " ").trim();
  const email = input.email.trim();
  const phone = input.phone.trim();
  if (!input.serviceKey) errors.service = "Please choose a service.";
  if (!input.startIso || Number.isNaN(Date.parse(input.startIso))) errors.time = "Please choose a day and time.";
  if (name.length < 2 || name.length > 120) errors.name = "Please enter your name.";
  else if (/[<>]/.test(name)) errors.name = "Your name cannot contain < or > characters.";
  if (!email && !phone) errors.contact = "Please give an email or a phone number so the business can reach you.";
  if (email && (email.length > 254 || !emailPattern.test(email))) errors.email = "Please enter a valid email address.";
  if (phone && (phone.length > 40 || !phonePattern.test(phone) || phone.replace(/\D/g, "").length < 7)) errors.phone = "Please enter a valid phone number.";
  if (input.notes.length > maxNotesLength) errors.notes = `Please keep your note to ${maxNotesLength} characters or fewer.`;
  else if (/[<>]/.test(input.notes)) errors.notes = "Your note cannot contain < or > characters.";
  return errors;
}

// One key per form fill. The database ignores a second send with the same key, so a double tap never makes two requests.
export function newIdempotencyKey(): string {
  const c = typeof crypto !== "undefined" ? crypto : undefined;
  if (c && typeof c.randomUUID === "function") return `web-${c.randomUUID()}`;
  return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

// Turns a database message into words a visitor can act on. Unknown messages never leak raw database text.
const known: [RegExp, string][] = [
  [/not open right now/i, "This booking page is not open right now."],
  [/too soon/i, "That time is too soon. Please choose a later time."],
  [/too far ahead/i, "That time is too far ahead. Please choose an earlier time."],
  [/opening hours|5-minute mark/i, "That time is not available. Please choose another time."],
  [/listed services/i, "Please choose one of the listed services."],
  [/several open requests/i, "You already have several open requests. Please wait to hear back."],
  [/a lot of requests/i, "There are a lot of requests right now. Please try again in a little while."],
  [/valid email/i, "Please enter a valid email address."],
  [/valid phone/i, "Please enter a valid phone number."],
  [/email or a phone/i, "Please give an email or a phone number so the business can reach you."],
  [/your name/i, "Please enter your name."],
  [/no < or >/i, "Please remove any < or > characters."],
];
export function friendlyBookingError(message: string | null | undefined): string {
  const text = String(message ?? "");
  for (const [pattern, words] of known) if (pattern.test(text)) return words;
  return "We could not send your request just now. Nothing was sent. Please try again in a moment.";
}

// A service needs a short code made of letters, numbers and single dashes (the database requires it). It is made from the name, kept unique among the
// business's own services, and never shown to customers.
export function serviceKeyFromName(name: string, existingKeys: string[]): string {
  const base = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50).replace(/-+$/g, "") || "service";
  if (!existingKeys.includes(base)) return base;
  for (let i = 2; i < 100; i += 1) { const next = `${base}-${i}`; if (!existingKeys.includes(next)) return next; }
  return `${base}-${Date.now().toString(36)}`;
}
export const timeZoneChoices: { value: string; label: string }[] = [
  { value: "America/New_York", label: "Eastern Time (New York)" }, { value: "America/Chicago", label: "Central Time (Chicago)" },
  { value: "America/Denver", label: "Mountain Time (Denver)" }, { value: "America/Phoenix", label: "Arizona (no daylight saving)" },
  { value: "America/Los_Angeles", label: "Pacific Time (Los Angeles)" }, { value: "America/Anchorage", label: "Alaska" },
  { value: "Pacific/Honolulu", label: "Hawaii" }, { value: "America/Toronto", label: "Toronto" }, { value: "America/Vancouver", label: "Vancouver" },
  { value: "Europe/London", label: "London" }, { value: "Europe/Paris", label: "Paris / Central Europe" }, { value: "Australia/Sydney", label: "Sydney" },
];
export const weekdayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
// Monday first, the way a business thinks of its week.
export const weekdayDisplayOrder = [1, 2, 3, 4, 5, 6, 0] as const;
