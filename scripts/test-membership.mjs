// Offline test: Membership v1 (track only). Checks the helper maths, the page promises and the draft gateway against the SQL draft.
// Planted-bug controls prove the checks can fail. Database behaviour is covered by docs/drafts/migrations/08_membership_tracking.test.sql.
import fs from "node:fs";
import { membersToCsv, daysUntil, dueSoon, friendlyMembershipError, membershipFromRow, memberProblem, renewalLabel, todayLocal } from "../src/lib/membershipGateway.ts";

let failures = 0;
function check(name, ok, detail = "") { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); } }
const read = (p) => fs.readFileSync(p, "utf8");

// ---- helpers
check("days until a date are counted on the calendar, across month, year and leap days", daysUntil("2026-10-18", "2026-10-17") === 1 && daysUntil("2026-11-01", "2026-10-17") === 15 && daysUntil("2027-01-01", "2026-12-31") === 1 && daysUntil("2028-03-01", "2028-02-28") === 2 && daysUntil("2026-10-10", "2026-10-17") === -7 && daysUntil("2026-10-17", "2026-10-17") === 0);
check("bad or impossible dates give no number (never a wrong one)", daysUntil("", "2026-10-17") === null && daysUntil("2026-02-30", "2026-10-17") === null && daysUntil("17/10/2026", "2026-10-17") === null && daysUntil("2026-10-17", "nope") === null);
check("renewal labels are plain words", renewalLabel("2026-10-17", "2026-10-17") === "Renews today" && renewalLabel("2026-10-18", "2026-10-17") === "Renews tomorrow" && renewalLabel("2026-10-27", "2026-10-17") === "Renews in 10 days" && renewalLabel("2026-10-16", "2026-10-17") === "Renewal was 1 day ago" && renewalLabel("2026-10-14", "2026-10-17") === "Renewal was 3 days ago" && renewalLabel("", "2026-10-17") === "No renewal date");
check("today comes from the local calendar date, zero padded", todayLocal(new Date(2026, 0, 5, 23, 59)) === "2026-01-05" && todayLocal(new Date(2026, 11, 31, 0, 0)) === "2026-12-31");
const m = (over) => ({ id: "x", email: "a@b.co", fullName: "", phone: "", tierId: "t", status: "active", renewsOn: "", notes: "", ...over });
check("'due soon' = active members overdue or within 14 days; paused, ended and undated members never count", dueSoon([m({ renewsOn: "2026-10-20" }), m({ renewsOn: "2026-10-01" }), m({ renewsOn: "2026-10-31" }), m({ renewsOn: "2026-11-05" }), m({ renewsOn: "2026-10-20", status: "paused" }), m({ renewsOn: "2026-10-20", status: "ended" }), m({ renewsOn: "" })], "2026-10-17").length === 3);
const input = (over) => ({ id: null, email: "a@b.co", fullName: "", phone: "", tierId: "t", status: "active", renewsOn: "", notes: "", ...over });
check("member problems are caught in plain words", memberProblem(input({ email: "nope" }), "2026-10-17").includes("valid email") && memberProblem(input({ tierId: "" }), "2026-10-17").includes("tier") && memberProblem(input({ renewsOn: "2026-02-30" }), "2026-10-17").includes("real renewal") && memberProblem(input({ renewsOn: "2099-01-01" }), "2026-10-17").includes("looks wrong") && memberProblem(input({ notes: "n".repeat(501) }), "2026-10-17").includes("500") && memberProblem(input({ renewsOn: "2026-12-01" }), "2026-10-17") === "");
check("database rows become safe values: unknown status becomes active, junk rows are dropped, dates are trimmed", (() => {
  const d = membershipFromRow({ tiers: [{ id: "t1", name: "Gold", perks: null, active: false }, { id: "", name: "x" }, "junk"], members: [{ id: "m1", email: "A@B.co", tier_id: "t1", status: "weird", renews_on: "2026-11-01T00:00:00Z" }, { id: "m2" }] });
  return d.tiers.length === 1 && d.tiers[0].active === false && d.tiers[0].perks === "" && d.members.length === 1 && d.members[0].status === "active" && d.members[0].renewsOn === "2026-11-01";
})() && membershipFromRow(null).tiers.length === 0 && membershipFromRow("x").members.length === 0);
check("database messages turn into plain words and unknown ones never leak", friendlyMembershipError("That email is already a member.") === "That email is already a member." && !/violates|constraint|pg_/i.test(friendlyMembershipError('duplicate key value violates unique constraint "commerce_members_pkey"')) && friendlyMembershipError(undefined).includes("Nothing was changed"));

const csv = membersToCsv([m({ email: "a@b.co", fullName: '=HYPERLINK("http://evil")', notes: 'said "hi", left', phone: "+15550100", renewsOn: "2026-11-01" }), m({ id: "y", email: "c@d.co", fullName: "Line\nBreak", tierId: "gone" })], [{ id: "t", name: "Gold", perks: "", active: true }]);
check("the CSV opens in Excel (byte-order mark), has a header, quotes every cell and uses the tier name", csv.startsWith('\uFEFF"Email","Name"') && csv.split("\r\n")[1].includes('"Gold"'));
check("the CSV can never run a customer's text as a formula, and quotes and commas stay inside their cell", csv.includes('"\'=HYPERLINK(""http://evil"")"') && csv.includes('"\'+15550100"') && csv.includes('"said ""hi"", left"') && !/,"=/.test(csv) && !/,"\+/.test(csv));
check("CSV for an empty list is just the header", membersToCsv([], []).split("\r\n").length === 2 && membersToCsv([], []).includes("Renews on"));

// ---- files
const sql = read("supabase/migrations/284_membership_tracking.sql");
const gw = read("src/lib/membershipSupabaseGateway.ts");
const page = read("src/pages/ClientMembership.tsx");
const lib = read("src/lib/membershipGateway.ts");
const app = read("src/App.tsx");

const sqlArgs = (s, name) => { const f = s.match(new RegExp(`function public\\.${name}\\(([^)]*)\\)`)); return f ? [...f[1].matchAll(/(?:^|,)\s*(\w+_value)\s/g)].map((x) => x[1]).sort().join(",") : ""; };
const gatewayArgs = (g, name) => { const f = g.match(new RegExp(`rpc\\("${name}",\\s*\\{([\\s\\S]*?)\\}\\)`)); return f ? [...f[1].matchAll(/(\w+_value)\s*:/g)].map((x) => x[1]).sort().join(",") : ""; };
const wired = ["save_my_member_tier", "save_my_member", "remove_my_member"];
const checks = (s, g, p, l, a, cfg = read("src/lib/membershipConfig.ts")) => ({
  argsMatch: wired.every((n) => sqlArgs(s, n) !== "" && sqlArgs(s, n) === gatewayArgs(g, n)) && /function public\.list_my_membership\(\)/.test(s) && g.includes('rpc("list_my_membership")'),
  noSrcRpc: !/\.rpc\(/.test(p) && !/\.rpc\(/.test(l),
  honest: /Nothing here charges anyone or sends messages/.test(p) && /You bill them yourself/.test(p) && !/auto-?renew|subscribe now|payment received|charged/i.test(p.replace(/does not charge|charges anyone/gi, "")),
  noLockedShelf: !/members?-only|members_only|locked/i.test(p),
  tablesClosed: ["commerce_member_tiers", "commerce_members", "commerce_member_only_products"].every((t) => new RegExp(`alter table public\\.${t} enable row level security`).test(s) && new RegExp(`revoke all on table public\\.${t} from public, anon, authenticated`).test(s)),
  noAnonFunctions: !/grant execute on function[^;]*to[^;]*\banon\b/.test(s),
  helperInternal: /revoke all on function public\.nxq_member_owner_store\(\) from public, anon, authenticated/.test(s),
  notEnforcedSaid: /'enforced', false/.test(s) && /record only/i.test(s),
  noRawHtml: !/dangerouslySetInnerHTML/.test(p),
  safeLinks: /href=\{`mailto:\$\{m\.email\}`\}/.test(p) && p.includes("[^@\\s?&#%]+@") && /replace\(\/\[\^0-9\+\]\/g, ""\)/.test(p) && p.includes("/[0-9]/.test(m.phone)"),
  staleFormSafe: p.includes("active: tier.id ? (data.tiers.find((t) => t.id === tier.id)?.active ?? tier.active) : tier.active"),
  countsFollowTiers: p.includes('m.status === "active" && activeTierIds.has(m.tierId)') && p.includes("dueSoon(countedMembers, today)"),
  honestRefreshError: p.includes("Saved, but the list could not refresh") && p.includes("saved = true; await reload();"),
  messagesScrolled: p.includes("scrollIntoView"),
  oldDatesEditable: l.includes("d < -3650 || d > 3650") && s.includes("renews_on_value < current_date - 3650"),
  removeAsks: /window\.confirm\(`Remove /.test(p),
  caps: /maxTiers = 10/.test(l) && /maxMembers = 2000/.test(l) && />= 10 then/.test(s) && />= 2000 then/.test(s),
  labels: ["tier-name", "tier-perks", "mem-email", "mem-name", "mem-phone", "mem-tier", "mem-status", "mem-renews", "mem-notes", "mem-filter", "mem-search"].every((id) => new RegExp(`htmlFor="${id}"`).test(p) && new RegExp(`id="${id}"`).test(p)) && /role="alert"/.test(p),
  unavailable: /data-testid="membership-unavailable"/.test(p),
  routedButOff: /ClientMembershipRoute/.test(a) && /ownerMembershipGateway: OwnerMembershipGateway \| null = null;/.test(cfg),
  csvButton: /Download list \(CSV\)/.test(p) && /URL\.revokeObjectURL/.test(p) && /disabled=\{data\.members\.length === 0\}/.test(p),
  singleFlight: /if \(busy\) return;/.test(p),
});
const good = checks(sql, gw, page, lib, app);
check("the draft gateway calls exactly the functions and argument names the SQL defines", good.argsMatch);
check("no database call lives in the page (only the gateway file calls the database)", good.noSrcRpc);
check("the page says plainly it only keeps a list (you bill them yourself, nothing is charged or sent) and never claims payments", good.honest);
check("the page has no locked-products idea at all (owner decided against pay-to-see)", good.noLockedShelf);
check("all three tables are closed to every API role, and no function is granted to anonymous visitors", good.tablesClosed && good.noAnonFunctions && good.helperInternal);
check("the database says the members-only flag is a record only", good.notEnforcedSaid);
check("no raw HTML; mailto and tel links are cleaned; removing a member asks first", good.noRawHtml && good.safeLinks && good.removeAsks);
check("tier and member caps match between page and database", good.caps);
check("every field has a label, errors are announced, there is a calm 'not available' state, and double-clicks are ignored", good.labels && good.unavailable && good.singleFlight);
check("the page can download the member list as a CSV (off when empty, object URL released)", good.csvButton);
check("PLANTED BUG caught: the CSV button is removed", checks(sql, gw, page.replace("Download list (CSV)", "Download"), lib, app).csvButton === false);
check("the Members reviewer's findings stay fixed: a stale tier form cannot flip a tier back, counts follow paused tiers, a failed refresh is not reported as a failed save, messages scroll into view, old renewal dates stay editable", good.staleFormSafe && good.countsFollowTiers && good.honestRefreshError && good.messagesScrolled && good.oldDatesEditable);
check("PLANTED BUG caught: stale tier form flips the tier", checks(sql, gw, page.replace("active: tier.id ? (data.tiers.find((t) => t.id === tier.id)?.active ?? tier.active) : tier.active", "active: tier.active"), lib, app).staleFormSafe === false);
check("PLANTED BUG caught: paused-tier members still counted", checks(sql, gw, page.replace('m.status === "active" && activeTierIds.has(m.tierId)', 'm.status === "active"'), lib, app).countsFollowTiers === false);
check("PLANTED BUG caught: refresh failure reported as a failed save", checks(sql, gw, page.replace("saved = true; await reload();", "await reload();"), lib, app).honestRefreshError === false);
check("PLANTED BUG caught: an odd email becomes a mailto link", checks(sql, gw, page.replace("[^@\\s?&#%]+@", "[^@\\s]+@"), lib, app).safeLinks === false);
check("PLANTED BUG caught: old renewal dates become uneditable", checks(sql, gw, page, lib.replace("d < -3650", "d < -365"), app).oldDatesEditable === false);
check("the page is routed (/client/members) but its switch in membershipConfig.ts is OFF (null) until migration 284 is applied and the product decisions are made", good.routedButOff);
check("PLANTED BUG caught: gateway argument drifts from the SQL", checks(sql, gw.replace("tier_id_value: input.tierId", "tier: input.tierId"), page, lib, app).argsMatch === false);
check("PLANTED BUG caught: a database call sneaks into src", checks(sql, gw, page + '\nsupabase.rpc("list_my_membership");', lib, app).noSrcRpc === false);
check("PLANTED BUG caught: page claims it charges", checks(sql, gw, page.replace("You bill them yourself.", "Members are charged automatically."), lib, app).honest === false);
check("PLANTED BUG caught: a locked-products idea sneaks into the page", checks(sql, gw, page + "\n// members-only shelf", lib, app).noLockedShelf === false);
check("PLANTED BUG caught: a table opens to API roles", checks(sql.replace("revoke all on table public.commerce_members from public, anon, authenticated;", ""), gw, page, lib, app).tablesClosed === false);
check("PLANTED BUG caught: a function is granted to anonymous visitors", checks(sql + "\ngrant execute on function public.list_my_membership() to anon, authenticated;", gw, page, lib, app).noAnonFunctions === false);
check("PLANTED BUG caught: the switch is turned on before approval", checks(sql, gw, page, lib, app, read("src/lib/membershipConfig.ts").replace("ownerMembershipGateway: OwnerMembershipGateway | null = null;", "ownerMembershipGateway: OwnerMembershipGateway | null = {};")).routedButOff === false);
check("PLANTED BUG caught: removing no longer asks", checks(sql, gw, page.replace("window.confirm(`Remove ", "(`Remove "), lib, app).removeAsks === false);
check("PLANTED BUG caught: tier cap drifts", checks(sql, gw, page, lib.replace("maxTiers = 10", "maxTiers = 20"), app).caps === false);
check("PLANTED BUG caught: a label is lost", checks(sql, gw, page.replace('htmlFor="mem-renews"', 'htmlFor="mem-x"'), lib, app).labels === false);
check("PLANTED BUG caught: renewal maths off by one", (() => { const bad = (a, b) => Math.round((Date.UTC(...a) - Date.UTC(...b)) / 86_400_000) + 1; return bad([2026, 9, 18], [2026, 9, 17]) !== 1; })());

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll membership checks passed (offline).");
process.exit(failures ? 1 : 0);
