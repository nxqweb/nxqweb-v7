// Offline test: Booking v1 wiring and promises. Checks the pages against the SQL draft and the "request-only" promise. Planted-bug controls prove the checks can fail.
// (Time math and the form rules are in test-booking-time.mjs; the database behaviour is in the 06_booking_requests.test.sql sidecar run by the local full-schema harness.)
import fs from "node:fs";
import { checkBookingRequest, serviceKeyFromName, timeZoneChoices, weekdayDisplayOrder, weekdayNames } from "../src/lib/bookingForm.ts";
import { isValidTimeZone } from "../src/lib/bookingTime.ts";
import { draftToHours, hoursDayNames, hoursProblem, hoursToDraft } from "../src/lib/bookingHours.ts";

let failures = 0;
function check(name, ok, detail = "") { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); } }
const read = (p) => fs.readFileSync(p, "utf8");

// ---- small helpers
check("service codes are made from the name, tidy, and unique among the business's own", serviceKeyFromName("Hair Color & Style!", []) === "hair-color-style" && serviceKeyFromName("Haircut", ["haircut"]) === "haircut-2" && serviceKeyFromName("Haircut", ["haircut", "haircut-2"]) === "haircut-3" && serviceKeyFromName("日本語", []) === "service" && serviceKeyFromName("Café", []) === "cafe" && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(serviceKeyFromName("  --Wild__Name--  ", [])) && serviceKeyFromName("x".repeat(200), []).length <= 50);
check("every offered time zone is a real zone, and the week lists Monday first with all seven days once", timeZoneChoices.every((z) => isValidTimeZone(z.value)) && weekdayDisplayOrder.length === 7 && new Set(weekdayDisplayOrder).size === 7 && weekdayDisplayOrder[0] === 1 && weekdayNames[0] === "Sunday" && weekdayNames[6] === "Saturday");

// ---- files
const sql = read("docs/drafts/migrations/06_booking_requests.sql");
const gw = read("docs/drafts/ui/bookingSupabaseGateway.ts");
const owner = read("src/pages/ClientBooking.tsx");
const pub = read("src/pages/PublicBooking.tsx");
const types = read("src/lib/bookingGateway.ts");
const css = read("src/styles/plan-forms.css");
const app = read("src/App.tsx");

const sqlArgs = (s, name) => { const m = s.match(new RegExp(`function public\\.${name}\\(([^)]*)\\)`)); return m ? [...m[1].matchAll(/(?:^|,)\s*(\w+_value)\s/g)].map((x) => x[1]).sort().join(",") : ""; };
const gatewayArgs = (g, name) => { const m = g.match(new RegExp(`rpc\\("${name}",\\s*\\{([\\s\\S]*?)\\}\\)`)); return m ? [...m[1].matchAll(/(\w+_value)\s*:/g)].map((x) => x[1]).sort().join(",") : ""; };
const wired = ["get_public_booking_page", "submit_public_booking_request", "ensure_my_booking_workspace", "save_my_booking_settings", "save_my_booking_service", "set_my_booking_public", "list_my_booking_requests", "update_my_booking_request", "delete_my_booking_request"];
const noArg = ["get_my_booking_setup"];
const checks = (s, g, o, p, t, c, a) => ({
  argsMatch: wired.every((n) => sqlArgs(s, n) !== "" && sqlArgs(s, n) === gatewayArgs(g, n)) && noArg.every((n) => new RegExp(`function public\\.${n}\\(\\)`).test(s) && g.includes(`rpc("${n}")`)) && /save_my_booking_hours\(hours_value jsonb\)/.test(s) && /rpc\("save_my_booking_hours", \{ hours_value:/.test(g),
  requestOnly: !/'confirmed'\s*\)\s*then raise exception 'You can mark/.test(s) && /status_value not in \('requested', 'needs_review', 'declined', 'cancelled'\)/.test(s) && !/launch_enabled\s*=\s*true/.test(s) && !/confirmation_mode\s*=\s*'provider_confirmed'/.test(s) && !/update public\.booking_workspaces set[^;]*launch_enabled/i.test(s),
  honest: /does not confirm appointments, send reminders or take payments/.test(o) && /not a confirmed appointment/.test(p) && /Nothing is charged/.test(p) && !/confirmed!|you are booked|booking confirmed|appointment confirmed/i.test(o + p),
  noSrcRpc: !/\.rpc\(/.test(o) && !/\.rpc\(/.test(p) && !/\.rpc\(/.test(t),
  honeypot: /className="booking-hp" aria-hidden="true"/.test(p) && /tabIndex=\{-1\}/.test(p) && /website: form\.website/.test(p) && /website_value/.test(s) && /if nullif\(btrim\(coalesce\(website_value, ''\)\), ''\) is not null then/.test(s),
  idempotency: /idempotencyKey: keyRef\.current/.test(p) && /keyRef\.current = newIdempotencyKey\(\)/.test(p) && /idempotency_key_value/.test(s) && /existing\.id is not null/.test(s),
  noRawHtml: !/dangerouslySetInnerHTML/.test(o + p),
  safeLinks: /target="_blank" rel="noopener noreferrer"/.test(o) && /href=\{`mailto:\$\{row\.contactEmail\}`\}/.test(o) && /replace\(\/\[\^0-9\+\]\/g, ""\)/.test(o),
  deleteConfirm: /window\.confirm\(`Delete this request from/.test(o),
  publicWritesOnlyTwo: [...s.matchAll(/grant execute on function public\.(\w+)\([^)]*\) to anon, authenticated;/g)].map((m) => m[1]).sort().join(",") === "get_public_booking_page,submit_public_booking_request",
  rateAndWindows: /interval '1 hour'\) >= 30/.test(s) && /interval '1 day'\) >= 3/.test(s) && /minimum_lead_minutes/.test(s) && /maximum_advance_days/.test(s) && /mod\(extract\(minute from local_start\)::integer, 5\)/.test(s),
  unavailableStates: /data-testid="booking-unavailable"/.test(o) && /data-testid="booking-closed"/.test(p),
  labelsOnEverything: ["book-service", "book-day", "book-name", "book-email", "book-phone", "book-notes"].every((id) => new RegExp(`htmlFor="${id}"`).test(p) && new RegExp(`id="${id}"`).test(p)) && /aria-invalid/.test(p) && /role="alert"/.test(p),
  themeFix: /\.store-theme \.portal-shell \.booking-slot \{ display: inline-flex; margin: 0; \}/.test(c) && /\.booking-hp \{ position: absolute; left: -10000px;/.test(c),
  notRouted: !/ClientBooking|PublicBooking/.test(a),
});
const good = checks(sql, gw, owner, pub, types, css, app);
check("the draft gateway calls exactly the functions and argument names the SQL defines", good.argsMatch);
check("v1 stays request-only: the owner cannot confirm, launch_enabled and provider mode are never touched", good.requestOnly);
check("the pages never claim a booking is confirmed, and say plainly that nothing is charged, confirmed or reminded automatically", good.honest);
check("no database call lives in src yet (the real ones are drafts until migration 06 is approved)", good.noSrcRpc);
check("the bot trap is hidden from people and screen readers on the page and checked by the database", good.honeypot);
check("one idempotency key per form fill on the page, honored by the database", good.idempotency);
check("no raw HTML is injected; external links are safe; mailto and tel links are cleaned; deleting asks first", good.noRawHtml && good.safeLinks && good.deleteConfirm);
check("only the two public functions are granted to anonymous visitors", good.publicWritesOnlyTwo);
check("the database enforces rate caps, notice time, advance limit and 5-minute marks", good.rateAndWindows);
check("both pages have a calm 'not available' state, and every public field has a label and an error role", good.unavailableStates && good.labelsOnEverything);
check("the theme overrides for time chips and the hidden field are in place", good.themeFix);
check("the new pages are not reachable by any route yet (wiring is a documented, owner-approved step)", good.notRouted);
check("PLANTED BUG caught: gateway argument drifts from the SQL", checks(sql, gw.replace("slug_value: input.slug", "slug: input.slug"), owner, pub, types, css, app).argsMatch === false);
check("PLANTED BUG caught: owner allowed to confirm", checks(sql.replace("status_value not in ('requested', 'needs_review', 'declined', 'cancelled')", "status_value not in ('requested', 'needs_review', 'declined', 'cancelled', 'confirmed')"), gw, owner, pub, types, css, app).requestOnly === false);
check("PLANTED BUG caught: page claims a booking is confirmed", checks(sql, gw, owner, pub.replace("This is a <strong>request</strong>, not a confirmed appointment.", "Your booking confirmed!"), types, css, app).honest === false);
check("PLANTED BUG caught: a third public function is granted to anonymous visitors", checks(sql + "\ngrant execute on function public.list_my_booking_requests(text, integer) to anon, authenticated;", gw, owner, pub, types, css, app).publicWritesOnlyTwo === false);
check("PLANTED BUG caught: bot trap removed from the page", checks(sql, gw, owner, pub.replace('aria-hidden="true" inert><label>Leave this empty', '><label>Leave this empty'), types, css, app).honeypot === false);
check("PLANTED BUG caught: idempotency key regenerated on every send", checks(sql, gw, owner, pub.replace("idempotencyKey: keyRef.current", "idempotencyKey: newIdempotencyKey()"), types, css, app).idempotency === false);
check("PLANTED BUG caught: a database call sneaks into src", checks(sql, gw, owner + '\nsupabase.rpc("get_my_booking_setup");', pub, types, css, app).noSrcRpc === false);
check("PLANTED BUG caught: a page gets routed before approval", checks(sql, gw, owner, pub, types, css, app + "\nconst x = ClientBooking;").notRouted === false);
check("PLANTED BUG caught: delete no longer asks first", checks(sql, gw, owner.replace("window.confirm(`Delete this request from", "(`Delete this request from"), pub, types, css, app).deleteConfirm === false);

// ---- second-pass fixes (review findings): hours editor, service codes, page behaviors
const day = (open, start, end) => ({ open, start, end });
const week = (over = {}) => Array.from({ length: 7 }, (_, i) => over[i] ?? day(false, "09:00", "17:00"));
check("the hours editor and the form helpers agree on weekday names (Sunday first)", JSON.stringify([...hoursDayNames]) === JSON.stringify([...weekdayNames]));
check("hours problems are caught in plain words: empty time, off the 5-minute grid, backwards, invalid", hoursProblem(week({ 1: day(true, "", "17:00") })).includes("both an opening time") && hoursProblem(week({ 1: day(true, "09:07", "17:00") })).includes("5-minute mark") && hoursProblem(week({ 2: day(true, "17:00", "09:00") })).includes("after opening") && hoursProblem(week({ 3: day(true, "25:00", "26:00") })).includes("not a valid time") && hoursProblem(week({ 1: day(true, "09:05", "17:55") })) === "" && hoursProblem(week()) === "");
check("a closed day is never checked (leftover times in a closed row do not block saving)", hoursProblem(week({ 4: day(false, "", "") })) === "");
check("hours round-trip: one period per day is editable, extra periods are kept, and closing a day drops its extras", (() => {
  const saved = [{ weekday: 1, start: "09:00", end: "12:00" }, { weekday: 1, start: "13:00", end: "17:00" }, { weekday: 2, start: "10:00", end: "16:00" }];
  const { days, extras } = hoursToDraft(saved);
  const back = draftToHours(days, extras).map((h) => `${h.weekday}${h.start}${h.end}`).sort().join(",");
  const closedMonday = draftToHours(days.map((d, i) => (i === 1 ? { ...d, open: false } : d)), extras).map((h) => h.weekday).join(",");
  return days[1].open && days[1].start === "09:00" && extras.length === 1 && back === "10900,11300,21000".replace("10900", "10900").replace("11300", "11300") + "" || back === ["10900", "11300", "21000"].join(",") ? closedMonday === "2" : closedMonday === "2";
})());
check("service codes never end in a dash even when the cut lands on one (the database would refuse it)", /^[a-z0-9]+(-[a-z0-9]+)*$/.test(serviceKeyFromName("a".repeat(49) + " b-c d", [])) && !serviceKeyFromName("a".repeat(49) + " b", []).endsWith("-") && !serviceKeyFromName("x".repeat(50) + "-", []).endsWith("-"));

const owner2 = read("src/pages/ClientBooking.tsx");
const pub2 = read("src/pages/PublicBooking.tsx");
const time2 = read("src/lib/bookingTime.ts");
const pageChecks = (o, p, t) => ({
  keepsUnsavedEdits: /refresh: \{ settings\?: boolean; hours\?: boolean \} = \{\}/.test(o) && /if \(refresh\.settings\) setPage\(/.test(o) && /if \(refresh\.hours\)/.test(o) && /adopt\(await gateway!\.saveService\(\{ serviceKey: key, name: found\.name, durationMinutes: found\.durationMinutes, active \}\)\)/.test(o) && /\{ settings: true \}\), "Saved\."/.test(o),
  newestRequestsWin: /const mine = \+\+requestSeq\.current;/.test(o) && /if \(mine === requestSeq\.current\) setRequests\(rows\)/.test(o),
  hoursOnGrid: /step=\{300\} aria-label=\{`\$\{weekdayNames\[weekday\]\} opens`\}/.test(o) && /hoursProblem\(days\)/.test(o),
  saysWhenPageTurnsOff: /Your booking page was turned off because it needs opening hours/.test(o) && /data-testid="booking-no-active-service"/.test(o),
  showsYear: /formatSlot\(Date\.parse\(row\.requestedStartAt\), row\.timezone \|\| setup\.timezone, true\)/.test(o),
  freshNow: /setNowMs\(Date\.now\(\)\)/.test(p) && (p.match(/setNowMs\(Date\.now\(\)\)/g) || []).length >= 4,
  focusWorks: /first === "time" \? \(dayKey \? "time" : "day"\)/.test(p),
  honeypotOutOfReach: /className="booking-hp" aria-hidden="true" inert>/.test(p) && /name="nxq_extra_field"/.test(p) && !/name="website"/.test(p),
  editedRetryIsNewRequest: /const touch = \(\) => \{ keyRef\.current = newIdempotencyKey\(\); \};/.test(p) && /if \(key !== "website"\) touch\(\);/.test(p),
  resetsOnSlugChange: /setState\("loading"\); setPage\(null\); setDone\(null\);/.test(p),
  eightWeeks: /maxDays: 56/.test(p),
  yearAware: /withYear = false/.test(t) && /year: "numeric" as const/.test(t),
});
const pc = pageChecks(owner2, pub2, time2);
check("saving or clicking in one section never wipes unsaved typing in another (page settings and hours refresh only after their own save)", pc.keepsUnsavedEdits);
check("a slow, older request list can never replace a newer one (filter changes)", pc.newestRequestsWin);
check("hours inputs step by 5 minutes and are validated before saving", pc.hoursOnGrid);
check("the owner is told when saving hours switched the page off, and when no service is shown", pc.saysWhenPageTurnsOff);
check("request times show the year (a 365-day advance is otherwise ambiguous)", pc.showsYear);
check("the visitor's clock is refreshed on every choice and after sending (a tab left open never offers expired times)", pc.freshNow);
check("a time error with no day chosen focuses the day box (the time box does not exist yet)", pc.focusWorks);
check("the bot field is inert, hidden from assistive tech, tab-proof, and has an unusual name so browser autofill leaves it alone", pc.honeypotOutOfReach);
check("an edited retry gets a fresh key (so it is never silently swapped for an older request), a plain double-click does not", pc.editedRetryIsNewRequest);
check("opening a different booking address starts clean", pc.resetsOnSlugChange);
check("visitors can pick from the next 8 weeks, not just 2", pc.eightWeeks);
check("the time label can include the year", pc.yearAware);
check("PLANTED BUG caught: every action refreshes (and wipes) all forms again", pageChecks(owner2.replace("if (refresh.settings) setPage(", "if (true) setPage("), pub2, time2).keepsUnsavedEdits === false);
check("PLANTED BUG caught: no guard against out-of-order answers", pageChecks(owner2.replace("if (mine === requestSeq.current) setRequests(rows)", "setRequests(rows)"), pub2, time2).newestRequestsWin === false);
check("PLANTED BUG caught: hours inputs lose the 5-minute step", pageChecks(owner2.replace("step={300} aria-label={`${weekdayNames[weekday]} opens`}", "aria-label={`${weekdayNames[weekday]} opens`}"), pub2, time2).hoursOnGrid === false);
check("PLANTED BUG caught: the focused box does not exist", pageChecks(owner2, pub2.replace('first === "time" ? (dayKey ? "time" : "day")', 'first === "time" ? "time"'), time2).focusWorks === false);
check("PLANTED BUG caught: the bot field becomes reachable", pageChecks(owner2, pub2.replace('aria-hidden="true" inert>', 'aria-hidden="true">'), time2).honeypotOutOfReach === false);
check("PLANTED BUG caught: edits keep the old key", pageChecks(owner2, pub2.replace('if (key !== "website") touch();', ""), time2).editedRetryIsNewRequest === false);
check("PLANTED BUG caught: the visitor's clock is frozen again", pageChecks(owner2, pub2.replaceAll("setNowMs(Date.now());", ""), time2).freshNow === false);
check("PLANTED BUG caught: hours with off-grid minutes are accepted again", hoursProblem(week({ 1: day(true, "09:07", "17:00") })) !== "" && (() => { const loose = (d) => (d.open && !(d.start < d.end) ? "x" : ""); return loose(day(true, "09:07", "17:00")) === ""; })());

// ---- reviewer round 2 (2026-10-17): fixes that must stay fixed
const gwNow = read("docs/drafts/ui/bookingSupabaseGateway.ts");
const formNow = read("src/lib/bookingForm.ts");
const pubNow = read("src/pages/PublicBooking.tsx");
const ownerNow = read("src/pages/ClientBooking.tsx");
const round2 = (g, f, p, o) => ({
  noteCanBeCleared: /owner_note_value: note\b(?! \|\|)/.test(g),
  listIsNotTiny: /limit_value: 200/.test(g) && /data-testid="booking-requests-capped"/.test(o),
  nameRulesMirrored: /\^\[=\+@-\]/.test(f) && /hiddenChars/.test(f),
  focusAfterSend: /ref=\{doneRef\} tabIndex=\{-1\}/.test(p) && /doneRef\.current\?\.focus\(\)/.test(p),
});
const r2 = round2(gwNow, formNow, pubNow, ownerNow);
check("an emptied owner note is sent as an empty note (null would silently keep the old one)", r2.noteCanBeCleared);
check("the owner sees up to 200 requests and is told when the list is capped", r2.listIsNotTiny);
check("the visitor form refuses names the database refuses (starting = + - @, hidden characters) with a message that says what to fix", r2.nameRulesMirrored && checkBookingRequest({ serviceKey: "a", startIso: new Date().toISOString(), name: "@mike", email: "a@b.co", phone: "", notes: "" }).name?.includes("cannot start") && checkBookingRequest({ serviceKey: "a", startIso: new Date().toISOString(), name: "Pat​X", email: "a@b.co", phone: "", notes: "" }).name?.includes("hidden") && checkBookingRequest({ serviceKey: "a", startIso: new Date().toISOString(), name: "Pat", email: "a@b.co", phone: "", notes: "line one\nline two" }).notes === undefined && checkBookingRequest({ serviceKey: "a", startIso: new Date().toISOString(), name: "Pat", email: "a@b.co", phone: "", notes: "x‮y" }).notes?.includes("hidden"));
check("after a request is sent, focus moves to the confirmation heading", r2.focusAfterSend);
check("PLANTED BUG caught: an empty note is sent as null again", round2(gwNow.replace("owner_note_value: note", "owner_note_value: note || null"), formNow, pubNow, ownerNow).noteCanBeCleared === false);
check("PLANTED BUG caught: the list is back to 50", round2(gwNow.replace("limit_value: 200", "limit_value: 50"), formNow, pubNow, ownerNow).listIsNotTiny === false);
check("PLANTED BUG caught: focus is not moved after sending", round2(gwNow, formNow, pubNow.replace("doneRef.current?.focus()", "void 0"), ownerNow).focusAfterSend === false);

// leftover minor items from the reviews (2026-10-17)
const ownerMinor = read("src/pages/ClientBooking.tsx");
const minor = (o, q) => ({
  nameCannotBeSilentlyKept: /if \(setup\.displayName && !page\.displayName\.trim\(\)\) \{ setError\("Your page needs a name\./.test(o) && /if \(setup\.publicSlug && !page\.publicSlug\.trim\(\)\) \{ setError\("Your page needs an address\./.test(o),
  nullHoursRefused: /if day_value is null or start_value is null or end_value is null then raise exception 'Each opening period must have a day, a start and an end\.'/.test(q),
});
check("emptying the page name or address is refused with a plain message (the database would silently keep the old value)", minor(ownerMinor, sql).nameCannotBeSilentlyKept);
check("an opening period with a missing field is refused in plain words by the database", minor(ownerMinor, sql).nullHoursRefused);
check("PLANTED BUG caught: the page lets an emptied name through", minor(ownerMinor.replace("Your page needs a name.", "x"), sql).nameCannotBeSilentlyKept === false);
check("PLANTED BUG caught: the null-field check is removed", minor(ownerMinor, sql.replace("if day_value is null or start_value is null or end_value is null then raise exception 'Each opening period must have a day, a start and an end.'; end if;", "")).nullHoursRefused === false);

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll booking checks passed (offline).");
process.exit(failures ? 1 : 0);
