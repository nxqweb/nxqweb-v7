// Offline test: Booking v1 wiring and promises. Checks the pages against the SQL draft and the "request-only" promise. Planted-bug controls prove the checks can fail.
// (Time math and the form rules are in test-booking-time.mjs; the database behaviour is in the 06_booking_requests.test.sql sidecar run by the local full-schema harness.)
import fs from "node:fs";
import { serviceKeyFromName, timeZoneChoices, weekdayDisplayOrder, weekdayNames } from "../src/lib/bookingForm.ts";
import { isValidTimeZone } from "../src/lib/bookingTime.ts";

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
  notRouted: !/ClientBooking|PublicBooking|ClientReviews/.test(a),
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
check("PLANTED BUG caught: bot trap removed from the page", checks(sql, gw, owner, pub.replace('aria-hidden="true"><label>Leave this empty', '><label>Leave this empty'), types, css, app).honeypot === false);
check("PLANTED BUG caught: idempotency key regenerated on every send", checks(sql, gw, owner, pub.replace("idempotencyKey: keyRef.current", "idempotencyKey: newIdempotencyKey()"), types, css, app).idempotency === false);
check("PLANTED BUG caught: a database call sneaks into src", checks(sql, gw, owner + '\nsupabase.rpc("get_my_booking_setup");', pub, types, css, app).noSrcRpc === false);
check("PLANTED BUG caught: a page gets routed before approval", checks(sql, gw, owner, pub, types, css, app + "\nconst x = ClientBooking;").notRouted === false);
check("PLANTED BUG caught: delete no longer asks first", checks(sql, gw, owner.replace("window.confirm(`Delete this request from", "(`Delete this request from"), pub, types, css, app).deleteConfirm === false);

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll booking checks passed (offline).");
process.exit(failures ? 1 : 0);
