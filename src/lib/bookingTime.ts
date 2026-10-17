// Booking times, done carefully: the business's opening hours are in THEIR time zone ("Mon 09:00 to 17:00 in Los Angeles"), while a request is stored as one exact
// moment. This file converts between the two (including daylight-saving changes) and builds the list of times a visitor can pick. The database re-checks every
// request against the same hours, so these helpers only decide what to OFFER; they never decide what is allowed.

export type HoursPeriod = { weekday: number; start: string; end: string }; // weekday 0 = Sunday ... 6 = Saturday, times "HH:MM"
export type SlotDay = { dateKey: string; label: string; slots: { startIso: string; label: string }[] };

const formatterCache = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

export function isValidTimeZone(timeZone: string): boolean {
  try { partsFormatter(timeZone).format(0); return true; } catch { return false; }
}

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };
export function localParts(utcMs: number, timeZone: string): LocalParts {
  const out: Record<string, number> = {};
  for (const part of partsFormatter(timeZone).formatToParts(new Date(utcMs))) if (part.type !== "literal") out[part.type] = Number(part.value);
  return { year: out.year, month: out.month, day: out.day, hour: out.hour % 24, minute: out.minute, second: out.second };
}
const asUtcMs = (p: LocalParts) => Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);

// The exact moment a wall-clock time happens in a time zone, or null when that wall-clock time does not exist (the hour skipped when clocks spring forward).
export function zonedTimeToUtcMs(dateKey: string, time: string, timeZone: string): number | null {
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  const clock = /^(\d{2}):(\d{2})$/.exec(time);
  if (!date || !clock) return null;
  const [year, month, day, hour, minute] = [Number(date[1]), Number(date[2]), Number(date[3]), Number(clock[1]), Number(clock[2])];
  const wanted = Date.UTC(year, month - 1, day, hour, minute, 0);
  let guess = wanted;
  for (let i = 0; i < 3; i += 1) {
    const shown = asUtcMs(localParts(guess, timeZone));
    guess -= shown - wanted;
  }
  const back = localParts(guess, timeZone);
  return back.year === year && back.month === month && back.day === day && back.hour === hour && back.minute === minute ? guess : null;
}

export function localDateKey(utcMs: number, timeZone: string): string {
  const p = localParts(utcMs, timeZone);
  return `${String(p.year).padStart(4, "0")}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}
// Weekday (0 = Sunday) of a calendar date, independent of any time zone.
export const weekdayOfDateKey = (dateKey: string) => new Date(`${dateKey}T12:00:00Z`).getUTCDay();
export function addDaysToDateKey(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const toMinutes = (time: string) => { const m = /^(\d{2}):(\d{2})/.exec(time); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };
const toClock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

export function formatSlot(utcMs: number, timeZone: string, withYear = false): string {
  try { return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric", ...(withYear ? { year: "numeric" as const } : {}), hour: "numeric", minute: "2-digit" }).format(new Date(utcMs)); }
  catch { return new Date(utcMs).toISOString(); }
}
const formatTimeOnly = (utcMs: number, timeZone: string) => { try { return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(utcMs)); } catch { return ""; } };
const formatDayLabel = (utcMs: number, timeZone: string) => { try { return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", month: "long", day: "numeric" }).format(new Date(utcMs)); } catch { return ""; } };

export type SlotOptions = {
  hours: HoursPeriod[];
  durationMinutes: number;
  timeZone: string;
  nowMs: number;
  minimumLeadMinutes: number;
  maximumAdvanceDays: number;
  stepMinutes?: number; // spacing between offered start times (default 30, always a multiple of 5)
  maxDays?: number;     // how many days ahead to list (default 14)
};

// The days and times a visitor can pick: inside the opening hours, long enough for the service to finish before closing, after the notice time, before the
// advance limit, and only on real wall-clock times (a skipped spring-forward hour is never offered).
export function generateSlots(options: SlotOptions): SlotDay[] {
  const step = Math.max(5, Math.round((options.stepMinutes ?? 30) / 5) * 5);
  const duration = options.durationMinutes;
  if (!Number.isFinite(duration) || duration < 5 || !isValidTimeZone(options.timeZone)) return [];
  const earliest = options.nowMs + options.minimumLeadMinutes * 60_000;
  const latest = options.nowMs + options.maximumAdvanceDays * 86_400_000;
  const days: SlotDay[] = [];
  const maxDays = Math.min(options.maxDays ?? 14, 60);
  const today = localDateKey(options.nowMs, options.timeZone);
  for (let offset = 0; offset <= maxDays && days.length < maxDays; offset += 1) {
    const dateKey = addDaysToDateKey(today, offset);
    const weekday = weekdayOfDateKey(dateKey);
    const periods = options.hours.filter((h) => h.weekday === weekday).sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
    const slots: SlotDay["slots"] = [];
    for (const period of periods) {
      const from = toMinutes(period.start); const to = toMinutes(period.end);
      if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
      for (let minute = from; minute + duration <= to; minute += step) {
        const startMs = zonedTimeToUtcMs(dateKey, toClock(minute), options.timeZone);
        if (startMs === null || startMs < earliest || startMs > latest) continue;
        // the service must also finish the same local day, on the real clock (elapsed time, so a daylight-saving jump during the service cannot hide or fake a slot)
        const end = localParts(startMs + duration * 60_000, options.timeZone);
        const endDateKey = `${String(end.year).padStart(4, "0")}-${String(end.month).padStart(2, "0")}-${String(end.day).padStart(2, "0")}`;
        if (endDateKey !== dateKey || end.hour * 60 + end.minute > to) continue;
        slots.push({ startIso: new Date(startMs).toISOString(), label: formatTimeOnly(startMs, options.timeZone) });
      }
    }
    if (slots.length) days.push({ dateKey, label: formatDayLabel(new Date(slots[0].startIso).getTime(), options.timeZone), slots });
  }
  return days;
}
