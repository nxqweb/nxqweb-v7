// How the Members page talks to the database. The page only knows this small interface, so it can be built and tested before the database functions exist.
// The real connection (src/lib/membershipSupabaseGateway.ts) is switched on in src/lib/membershipConfig.ts once migration 284 is applied.
// v1 only TRACKS members. Nothing here bills anyone, sends email or hides products from shoppers.

export type MemberTier = { id: string; name: string; perks: string; active: boolean };
export type MemberStatus = "active" | "paused" | "ended";
export type MemberRow = { id: string; email: string; fullName: string; phone: string; tierId: string; status: MemberStatus; renewsOn: string; notes: string };
export type MembershipData = { tiers: MemberTier[]; members: MemberRow[] };
export type MemberInput = { id: string | null; email: string; fullName: string; phone: string; tierId: string; status: MemberStatus; renewsOn: string; notes: string };
export type TierInput = { id: string | null; name: string; perks: string; active: boolean };

export type OwnerMembershipGateway = {
  load: () => Promise<MembershipData>;
  saveTier: (input: TierInput) => Promise<void>;
  saveMember: (input: MemberInput) => Promise<void>;
  removeMember: (id: string) => Promise<void>;
};

export const emptyMembership: MembershipData = { tiers: [], members: [] };
export const memberStatusLabel: Record<MemberStatus, string> = { active: "Active", paused: "Paused", ended: "Ended" };
export const maxTiers = 10;
export const maxMembers = 2000;

const text = (value: unknown) => (typeof value === "string" ? value : "");
const record = (value: unknown): Record<string, unknown> => (value && typeof value === "object" ? (value as Record<string, unknown>) : {});
const statusOf = (value: unknown): MemberStatus => (value === "paused" || value === "ended" ? value : "active");

export function membershipFromRow(row: unknown): MembershipData {
  const r = record(row);
  const tiers = (Array.isArray(r.tiers) ? r.tiers : []).map(record).filter((t) => text(t.id) && text(t.name))
    .map((t) => ({ id: text(t.id), name: text(t.name), perks: text(t.perks), active: t.active !== false }));
  const members = (Array.isArray(r.members) ? r.members : []).map(record).filter((m) => text(m.id) && text(m.email))
    .map((m) => ({ id: text(m.id), email: text(m.email), fullName: text(m.full_name), phone: text(m.phone), tierId: text(m.tier_id), status: statusOf(m.status), renewsOn: text(m.renews_on).slice(0, 10), notes: text(m.notes) }));
  return { tiers, members };
}

// Whole days from `today` to a YYYY-MM-DD date, counted on the calendar (no clock or time zone maths). null when there is no valid date.
export function daysUntil(renewsOn: string, today: string): number | null {
  const parse = (v: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v); if (!m) return null; const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])); const d = new Date(t); return d.getUTCMonth() === Number(m[2]) - 1 ? t : null; };
  const a = parse(renewsOn); const b = parse(today);
  return a === null || b === null ? null : Math.round((a - b) / 86_400_000);
}
export function renewalLabel(renewsOn: string, today: string): string {
  const d = daysUntil(renewsOn, today);
  if (d === null) return "No renewal date";
  if (d < 0) return `Renewal was ${-d} day${d === -1 ? "" : "s"} ago`;
  if (d === 0) return "Renews today";
  if (d === 1) return "Renews tomorrow";
  return `Renews in ${d} days`;
}
export const todayLocal = (now = new Date()) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

// Count of active members whose renewal is overdue or due within `days` days.
export function dueSoon(members: MemberRow[], today: string, days = 14): MemberRow[] {
  return members.filter((m) => { if (m.status !== "active") return false; const d = daysUntil(m.renewsOn, today); return d !== null && d <= days; });
}

export function memberProblem(input: MemberInput, today: string): string {
  const email = input.email.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) return "Enter a valid email address.";
  if (!input.tierId) return "Choose a tier.";
  if (input.fullName.trim().length > 160) return "Name must be 160 characters or fewer.";
  if (input.phone.trim().length > 80) return "Phone must be 80 characters or fewer.";
  if (input.notes.trim().length > 500) return "Notes must be 500 characters or fewer.";
  if (input.renewsOn) { const d = daysUntil(input.renewsOn, today); if (d === null) return "Choose a real renewal date."; if (d < -3650 || d > 3650) return "That renewal date looks wrong."; }
  return "";
}

// Owner-side messages in plain words. Unknown messages never leak raw database text.
export function friendlyMembershipError(message: string | null | undefined): string {
  const t = String(message ?? "");
  if (/Create your storefront first/i.test(t)) return "Set up your store first, then you can add members.";
  if (/Client workspace not found/i.test(t)) return "We could not find your workspace. Please sign in again.";
  if (/already have a tier/i.test(t)) return "You already have a tier with that name.";
  if (/up to 10 tiers/i.test(t)) return "You can have up to 10 tiers.";
  if (/already a member/i.test(t)) return "That email is already a member.";
  if (/2000 member limit/i.test(t)) return "You have reached the 2000 member limit.";
  if (/valid email/i.test(t)) return "Enter a valid email address.";
  if (/Choose one of your tiers/i.test(t)) return "Choose one of your tiers.";
  if (/Member not found|Tier not found/i.test(t)) return "That could not be found. It may already have been removed.";
  if (/Renewal date/i.test(t)) return "That renewal date looks wrong.";
  if (/not allowed/i.test(t)) return "Some characters are not allowed. Please remove any odd symbols.";
  if (/characters or fewer|1 to 80/i.test(t)) return "That text is too long or too short. Please check the limits shown next to the field.";
  return "We could not save that right now. Nothing was changed. Please try again in a moment.";
}

// A spreadsheet-safe CSV of the member list. Every cell is quoted; a cell that starts with = + - @ (or a tab/return) gets a leading apostrophe so Excel or Sheets
// never runs it as a formula (a customer could have typed anything as their name). Opens correctly in Excel thanks to the byte-order mark.
const csvCell = (value: string) => { const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value; return `"${safe.replace(/"/g, '""')}"`; };
export function membersToCsv(members: MemberRow[], tiers: MemberTier[]): string {
  const tierName = new Map(tiers.map((t) => [t.id, t.name]));
  const rows = [["Email", "Name", "Phone", "Tier", "Status", "Renews on", "Notes"], ...members.map((m) => [m.email, m.fullName, m.phone, tierName.get(m.tierId) ?? "", memberStatusLabel[m.status], m.renewsOn, m.notes])];
  return `\uFEFF${rows.map((r) => r.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
