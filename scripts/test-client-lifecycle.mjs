// Offline test for the owner's Pause / Cancel / free-first-month page (migration 285): the pure helpers, the rpc names and argument names against the migration,
// the storefront and portal wiring (failure-tolerant: an older database changes nothing), and the preflight pending list.
import fs from "node:fs";
import path from "node:path";

let failures = 0;
function check(name, ok) { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}`); } }
const read = (p) => fs.readFileSync(p, "utf8");
const m = await import(`${path.resolve("src/lib/clientLifecycle.ts")}?${Date.now()}`);
const sql = read("supabase/migrations/285_client_lifecycle.sql");

check("a missing day count is 'over'; 7 days or fewer is 'ending'; more is 'running'", m.firstMonthTone(null) === "over" && m.firstMonthTone(0) === "over" && m.firstMonthTone(-3) === "over" && m.firstMonthTone(7) === "ending" && m.firstMonthTone(8) === "running");
check("labels say plainly what to do", m.firstMonthLabel(30) === "30 days left of the free month" && m.firstMonthLabel(1) === "1 day left of the free month" && /today: time to invoice/.test(m.firstMonthLabel(0)) && /3 days ago: time to invoice/.test(m.firstMonthLabel(-3)) && m.firstMonthLabel(null) === "No free month");
check("a note needs 8 to 500 characters after trimming", !m.validNote("short") && !m.validNote("       x       ") && m.validNote("eight ch") && !m.validNote("x".repeat(501)) && m.validNote("x".repeat(500)));
check("junk never crashes the overview", ["x", null, 5, [], { paused: "no" }].every((v) => { const o = m.normalizeOverview(v); return Array.isArray(o.paused) && Array.isArray(o.first_month) && Array.isArray(o.needs_take_down); }));

const calls = [];
const gateway = m.createClientLifecycleGateway({ rpc: async (fn, args) => { calls.push([fn, args]); return { data: { message: "ok" }, error: null }; } });
await gateway.pause("c", "reason text"); await gateway.resume("c"); await gateway.cancel("c", "note text 1"); await gateway.markTakenDown("c"); await gateway.setFirstMonth("c", "2026-11-01"); await gateway.noteFirstInvoice("c"); await gateway.overview();
const signature = (fn) => { const hit = sql.match(new RegExp(`function public\\.${fn}\\(([^)]*)\\)`)); return hit ? hit[1].split(",").map((p) => p.trim().split(/\s+/)[0]).filter(Boolean) : null; };
check("every rpc name and argument name matches migration 285", calls.every(([fn, args]) => { const sig = signature(fn); return sig && Object.keys(args || {}).join() === sig.join(); }) && calls.length === 7);
const failing = m.createClientLifecycleGateway({ rpc: async () => ({ data: null, error: { message: "Owner access required." } }) });
check("a database refusal reaches the page as an error message", await failing.pause("c", "reason text").then(() => false, (e) => e.message === "Owner access required."));

const store = read("src/pages/PublicCommerceStorefront.tsx");
check("the store asks a yes/no function and treats any failure as open", /rpc\("get_public_store_status"/.test(store) && /accepting\?: unknown/.test(store) && /accepting === false\) setPaused\(true\)/.test(store) && /catch \{ \/\* open \*\/ \}/.test(store));
check("a paused store hides the cart, cart bar, add buttons and custom-request card but keeps the products visible", /orderMode\.mode === "menu" \|\| paused \? null/.test(store) && /viewOnly=\{orderMode\.mode === "menu" \|\| paused\}/.test(store) && /customRequestsOpen && !order && !paused/.test(store) && /data-testid="store-paused"/.test(store));
const portal = read("src/pages/ClientPortal.tsx");
check("the client portal shows a paused/cancelled notice from a separate tolerant query (the main client load is untouched)", /select\("paused_at, cancelled_at"\)/.test(portal) && /data-testid="lifecycle-notice"/.test(portal) && !/select\("id, business_name, status, billing_status, billing_provider, monthly_price, notes, paused/.test(portal));
check("the gate covers all four public tables with a before-insert trigger", ["commerce_orders", "commerce_customer_requests", "client_leads", "booking_appointment_requests"].every((t) => new RegExp(`before insert on public\\.${t}`).test(sql)));
check("owner functions check the owner and are closed to anon; the public status function is open", (sql.match(/from public\.owner_users where auth_user_id = auth\.uid\(\)/g) || []).length >= 7 && !/grant execute on function public\.owner_[a-z_]+\([^)]*\) to anon/.test(sql) && /grant execute on function public\.get_public_store_status\(text\) to anon, authenticated;/.test(sql));
check("the route and the owner menu link exist", /"\/owner\/client-lifecycle"/.test(read("src/App.tsx")) && /href="\/owner\/client-lifecycle"/.test(read("src/pages/OwnerPortal.tsx")));
check("the preflight records 285 as applied (nothing pending)", /expectedPendingMigrations = \[\];/.test(read("scripts/preflight-deploy-day.mjs")) && /lastAppliedMigration = 285;/.test(read("scripts/preflight-deploy-day.mjs")));

if (failures) { console.log(`\n${failures} check(s) FAILED`); process.exit(1); }
console.log("\nAll checks passed.");
