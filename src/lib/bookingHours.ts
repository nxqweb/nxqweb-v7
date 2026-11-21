// The weekly opening-hours editor: one editable period per weekday, plus extra periods (a second shift after a lunch break, for example) that the editor
// cannot show but must never lose. The database requires every opening time on a 5-minute mark, so the same rule is checked here before saving.
import type { HoursPeriod } from "./bookingTime";

// (Same names as bookingForm.weekdayNames; kept separate so this file has no runtime imports. A test checks they match.)
export const hoursDayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export type DayDraft = { open: boolean; start: string; end: string };
export const defaultDay: DayDraft = { open: false, start: "09:00", end: "17:00" };

export function hoursToDraft(hours: HoursPeriod[]): { days: DayDraft[]; extras: HoursPeriod[] } {
  const days = Array.from({ length: 7 }, () => ({ ...defaultDay }));
  const extras: HoursPeriod[] = [];
  const seen = new Set<number>();
  [...hours].sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start)).forEach((h) => {
    if (h.weekday < 0 || h.weekday > 6) return;
    if (!seen.has(h.weekday)) { seen.add(h.weekday); days[h.weekday] = { open: true, start: h.start, end: h.end }; } else extras.push(h);
  });
  return { days, extras };
}

export function draftToHours(days: DayDraft[], extras: HoursPeriod[]): HoursPeriod[] {
  const out: HoursPeriod[] = [];
  days.forEach((d, weekday) => { if (d.open) out.push({ weekday, start: d.start, end: d.end }); });
  return [...out, ...extras.filter((e) => days[e.weekday]?.open)];
}

const clock = /^(\d{2}):(\d{2})$/;
// Returns a plain sentence about the first problem, or an empty string when the hours are fine to save.
export function hoursProblem(days: DayDraft[]): string {
  for (let i = 0; i < 7; i += 1) {
    const d = days[i];
    if (!d.open) continue;
    const s = clock.exec(d.start); const e = clock.exec(d.end);
    if (!s || !e) return `${hoursDayNames[i]}: choose both an opening time and a closing time.`;
    if (Number(s[1]) > 23 || Number(e[1]) > 23 || Number(s[2]) > 59 || Number(e[2]) > 59) return `${hoursDayNames[i]}: that is not a valid time.`;
    if (Number(s[2]) % 5 !== 0 || Number(e[2]) % 5 !== 0) return `${hoursDayNames[i]}: use times on a 5-minute mark, such as 09:00 or 09:05.`;
    if (!(d.start < d.end)) return `${hoursDayNames[i]}: closing time must be after opening time.`;
  }
  return "";
}
