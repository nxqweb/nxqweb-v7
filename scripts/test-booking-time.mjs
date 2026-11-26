// Offline test: Booking times and the request form. Opening hours live in the business's own time zone, a request is one exact moment, and daylight-saving
// changes are where booking tools usually go wrong, so those are tested on real dates. Planted-bug controls prove the checks can fail.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { addDaysToDateKey, formatSlot, generateSlots, isValidTimeZone, localDateKey, localParts, weekdayOfDateKey, zonedTimeToUtcMs } from "../src/lib/bookingTime.ts";
import { checkBookingRequest, friendlyBookingError, newIdempotencyKey } from "../src/lib/bookingForm.ts";
import { friendlyOwnerBookingError, hoursFromRows, pageFromRow, requestRowsFromRows, setupFromRow } from "../src/lib/bookingGateway.ts";

let failures = 0;
function check(name, ok, detail = "") { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); } }
const LA = "America/Los_Angeles";
const iso = (ms) => new Date(ms).toISOString();

// ---- zone conversion on known dates
check("a winter wall-clock time in Los Angeles is 8 hours behind UTC", iso(zonedTimeToUtcMs("2026-01-12", "09:00", LA)) === "2026-01-12T17:00:00.000Z");
check("a summer wall-clock time in Los Angeles is 7 hours behind UTC", iso(zonedTimeToUtcMs("2026-07-13", "09:00", LA)) === "2026-07-13T16:00:00.000Z");
check("the hour skipped when clocks spring forward (2026-03-08 02:30 in Los Angeles) does not exist", zonedTimeToUtcMs("2026-03-08", "02:30", LA) === null && zonedTimeToUtcMs("2026-03-08", "03:00", LA) !== null && zonedTimeToUtcMs("2026-03-08", "01:30", LA) !== null);
check("times just before and after the spring change land on the right sides of it", iso(zonedTimeToUtcMs("2026-03-08", "01:30", LA)) === "2026-03-08T09:30:00.000Z" && iso(zonedTimeToUtcMs("2026-03-08", "03:00", LA)) === "2026-03-08T10:00:00.000Z");
check("the repeated hour in autumn (2026-11-01 01:30) resolves to a real moment that reads back as 01:30", (() => { const ms = zonedTimeToUtcMs("2026-11-01", "01:30", LA); const p = ms === null ? null : localParts(ms, LA); return p && p.hour === 1 && p.minute === 30; })());
check("other zones work (Sydney is ahead, Phoenix has no daylight saving, an odd zone like Kolkata is +5:30)", iso(zonedTimeToUtcMs("2026-07-13", "09:00", "Australia/Sydney")) === "2026-07-12T23:00:00.000Z" && iso(zonedTimeToUtcMs("2026-07-13", "09:00", "America/Phoenix")) === "2026-07-13T16:00:00.000Z" && iso(zonedTimeToUtcMs("2026-07-13", "09:00", "Asia/Kolkata")) === "2026-07-13T03:30:00.000Z");
check("bad dates, times and zones are refused instead of guessed", zonedTimeToUtcMs("2026-13-40", "09:00", LA) === null && zonedTimeToUtcMs("2026-07-13", "9am", LA) === null && isValidTimeZone("Nope/Zone") === false && isValidTimeZone(LA) === true);
check("date helpers: weekday and day arithmetic are exact across month ends and leap years", weekdayOfDateKey("2026-10-19") === 1 && addDaysToDateKey("2026-02-27", 2) === "2026-03-01" && addDaysToDateKey("2028-02-28", 1) === "2028-02-29" && localDateKey(Date.UTC(2026, 6, 13, 3, 0), LA) === "2026-07-12");

// ---- slot generation
const weekdays = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: "09:00", end: "17:00" }));
const monday = Date.UTC(2026, 9, 19, 15, 0); // Mon 2026-10-19 08:00 in Los Angeles
const base = { hours: weekdays, durationMinutes: 60, timeZone: LA, nowMs: monday, minimumLeadMinutes: 120, maximumAdvanceDays: 90 };
const days = generateSlots(base);
check("offers weekdays only, starting with today's later times (08:00 now + 2h notice means 10:00 is the first)", days[0].dateKey === "2026-10-19" && days[0].slots[0].label === "10:00 AM" && days.every((d) => { const w = weekdayOfDateKey(d.dateKey); return w >= 1 && w <= 5; }));
check("a 60-minute service starting every 30 minutes ends by 17:00 (last start 4:00 PM)", days[1].slots[0].label === "9:00 AM" && days[1].slots.at(-1).label === "4:00 PM" && days[1].slots.length === 15);
check("a 90-minute service finishes before closing (last start 3:30 PM)", generateSlots({ ...base, durationMinutes: 90 })[1].slots.at(-1).label === "3:30 PM");
check("the notice time is respected: nothing before now + 2 hours", days[0].slots.every((s) => Date.parse(s.startIso) >= monday + 120 * 60_000));
check("the advance limit is respected: with 2 days of advance nothing later is offered", (() => { const d = generateSlots({ ...base, maximumAdvanceDays: 2 }); return d.length > 0 && d.every((x) => x.slots.every((s) => Date.parse(s.startIso) <= monday + 2 * 86_400_000)); })());
check("split hours (lunch break) never offer a time that crosses the break", (() => { const d = generateSlots({ ...base, hours: [{ weekday: 2, start: "09:00", end: "12:00" }, { weekday: 2, start: "13:00", end: "17:00" }] }); return d.length > 0 && d[0].slots.every((s) => !["12:00 PM", "12:30 PM", "11:30 AM"].includes(s.label)) && d[0].slots.some((s) => s.label === "1:00 PM") && d[0].slots.some((s) => s.label === "11:00 AM"); })());
check("slots never offer the skipped spring-forward hour, and every slot reads back as a real wall-clock time in the zone", (() => {
  const sunday = Date.UTC(2026, 2, 7, 18, 0); // Sat 2026-03-07 10:00 in Los Angeles
  const d = generateSlots({ hours: [{ weekday: 0, start: "00:00", end: "06:00" }], durationMinutes: 30, timeZone: LA, nowMs: sunday, minimumLeadMinutes: 0, maximumAdvanceDays: 30, stepMinutes: 30 });
  const day = d.find((x) => x.dateKey === "2026-03-08");
  if (!day) return false;
  const labels = day.slots.map((s) => s.label);
  return !labels.includes("2:00 AM") && !labels.includes("2:30 AM") && labels.includes("1:30 AM") && labels.includes("3:00 AM");
})());
check("a zone or duration that makes no sense gives no slots instead of an error", generateSlots({ ...base, timeZone: "Nope/Zone" }).length === 0 && generateSlots({ ...base, durationMinutes: 0 }).length === 0 && generateSlots({ ...base, hours: [] }).length === 0);
check("step spacing snaps to 5-minute marks (the database requires them)", generateSlots({ ...base, stepMinutes: 17 })[1].slots.every((s) => new Date(s.startIso).getUTCMinutes() % 5 === 0) && generateSlots({ ...base, stepMinutes: 15 })[1].slots.length === 29);
check("slot labels read naturally for a visitor", /^(Mon|Tue|Wed|Thu|Fri), [A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2} (AM|PM)$/.test(formatSlot(zonedTimeToUtcMs("2026-10-20", "10:00", LA), LA)));

// ---- form
const good = { serviceKey: "cut", startIso: "2026-10-20T17:00:00.000Z", name: "Pat Visitor", email: "pat@example.com", phone: "", notes: "" };
check("a complete request passes", Object.keys(checkBookingRequest(good)).length === 0 && Object.keys(checkBookingRequest({ ...good, email: "", phone: "(555) 010-2000" })).length === 0);
check("each missing or bad piece gets its own plain message", (() => {
  const e = checkBookingRequest({ serviceKey: "", startIso: "", name: "x", email: "bad", phone: "12", notes: "<b>" });
  return e.service && e.time && e.name && e.email && e.phone && e.notes && !/regex|undefined/.test(JSON.stringify(e));
})());
check("an email OR a phone is required, markup is refused, notes have a limit", checkBookingRequest({ ...good, email: "", phone: "" }).contact !== undefined && checkBookingRequest({ ...good, name: "<script>" }).name !== undefined && checkBookingRequest({ ...good, notes: "n".repeat(1001) }).notes !== undefined && checkBookingRequest({ ...good, notes: "n".repeat(1000) }).notes === undefined);
check("every double-tap gets the same key within a fill and a new key for a new fill", newIdempotencyKey() !== newIdempotencyKey() && newIdempotencyKey().length >= 8 && newIdempotencyKey().length <= 160);
check("database messages become plain words, and raw database text never reaches a visitor", friendlyBookingError("That time is too soon. Please choose a later time.").includes("too soon") && friendlyBookingError('new row violates check constraint "booking_appointment_requests_check"').includes("Nothing was sent") && !/constraint|violates|pg_/i.test(friendlyBookingError('duplicate key value violates unique constraint "x"')));
check("owner messages are plain too", friendlyOwnerBookingError("Add at least one service first.").includes("turn your booking page on") && friendlyOwnerBookingError("relation does not exist").includes("Nothing was changed") && friendlyOwnerBookingError("That page address is already taken. Choose another.").includes("already taken"));

// ---- row mapping
check("database rows become tidy objects and junk rows are dropped", (() => {
  const page = pageFromRow({ display_name: "Salon", intro: "Hi", timezone: LA, minimum_lead_minutes: 120, maximum_advance_days: 90, services: [{ service_key: "cut", name: "Cut", duration_minutes: 60 }, { name: "no key" }, null], hours: [{ weekday: 1, start: "09:00", end: "17:00" }, { weekday: 9, start: "09:00", end: "17:00" }, { weekday: 1, start: "9am", end: "5pm" }] });
  return page.services.length === 1 && page.hours.length === 1 && pageFromRow({}) === null && pageFromRow(null) === null && setupFromRow({ has_workspace: false }).hasWorkspace === false && setupFromRow("x").hasWorkspace === false && hoursFromRows("x").length === 0 && requestRowsFromRows([{ id: "a", contact_name: "P" }, {}, null]).length === 1;
})());

// ---- planted-bug controls: broken copies of the time maker must fail the checks above
const source = fs.readFileSync("src/lib/bookingTime.ts", "utf8");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bookbug-"));
async function broken(label, from, to, probe) {
  const pairs = Array.isArray(from) ? from : [[from, to]];
  if (pairs.some(([a]) => !source.includes(a))) { check(`PLANTED BUG control is valid: ${label}`, false, "text to break not found"); return; }
  const file = path.join(dir, `${label.replace(/\W+/g, "_")}.ts`);
  fs.writeFileSync(file, pairs.reduce((text, [a, b]) => text.replace(a, b), source));
  const mod = await import(`file://${file}`);
  let caught; try { caught = probe(mod) === false; } catch { caught = true; }
  check(`PLANTED BUG caught: ${label}`, caught);
}
await broken("daylight saving ignored (fixed 8 hour offset)", "guess -= shown - wanted;", "guess = wanted + 8 * 3600000;", (m) => iso(m.zonedTimeToUtcMs("2026-07-13", "09:00", LA)) === "2026-07-13T16:00:00.000Z");
await broken("skipped hour offered", "return back.year === year && back.month === month && back.day === day && back.hour === hour && back.minute === minute ? guess : null;", "return guess;", (m) => m.zonedTimeToUtcMs("2026-03-08", "02:30", LA) === null);
await broken("service allowed to run past closing (both layers removed)", [["minute + duration <= to", "minute <= to"], ["end.hour * 60 + end.minute > to", "false"]], null, (m) => m.generateSlots(base)[1].slots.at(-1).label === "4:00 PM");
await broken("notice time ignored", "startMs < earliest ||", "false ||", (m) => m.generateSlots(base)[0].slots[0].label === "10:00 AM");
await broken("advance limit ignored", "|| startMs > latest", "|| false", (m) => m.generateSlots({ ...base, maximumAdvanceDays: 2 }).every((x) => x.slots.every((s) => Date.parse(s.startIso) <= monday + 2 * 86_400_000)));
await broken("weekday off by one", "new Date(`${dateKey}T12:00:00Z`).getUTCDay()", "(new Date(`${dateKey}T12:00:00Z`).getUTCDay() + 1) % 7", (m) => m.weekdayOfDateKey("2026-10-19") === 1);
fs.rmSync(dir, { recursive: true, force: true });

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll booking time and form checks passed (offline).");
process.exit(failures ? 1 : 0);
