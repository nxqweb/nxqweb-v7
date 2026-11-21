// Offline test: the store shipping fee (src/lib/storeShipping.ts, draft migration 08). The page's preview must do the same sum as the server,
// odd or missing data must always mean "no fee" (so an older database changes nothing), and the pages must only use the new order
// function when a rule is actually on.
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { checkShippingForm, noShipping, shippingFor, shippingFormFromRule, shippingHint, shippingRuleActive, shippingRuleFromRow } from "../src/lib/storeShipping.ts";

let failures = 0;
function check(name, ok, detail = "") { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); } }
const read = (file) => fs.readFileSync(file, "utf8");
const fmt = (n) => `$${n.toFixed(2)}`;
const blank = { mode: "flat", flatFee: "", freeOver: "", pickupAllowed: false, pickupNote: "" };

// ---- reading the rule
check("nothing, null, an array or text means no shipping fee", [undefined, null, [], "flat", 7].every((v) => JSON.stringify(shippingRuleFromRow(v)) === JSON.stringify(noShipping)));
check("an unknown mode or a flat rule without a real fee means no fee", ["weight", "flat", "flat", "flat"].every((mode, i) => shippingRuleFromRow({ mode, flat_fee: [5, 0, -3, "abc"][i] }).mode === "none"));
const flat = shippingRuleFromRow({ mode: "flat", flat_fee: "6.50", free_over: 50, pickup_allowed: true, pickup_note: "  Saturdays at the market  " });
check("a saved rule is read (numbers may arrive as text)", flat.mode === "flat" && flat.flatFee === 6.5 && flat.freeOver === 50 && flat.pickupAllowed && flat.pickupNote === "Saturdays at the market");
check("pickup only counts when it is exactly true, and the note needs pickup", shippingRuleFromRow({ mode: "flat", flat_fee: 5, pickup_allowed: "true", pickup_note: "x" }).pickupAllowed === false && shippingRuleFromRow({ mode: "flat", flat_fee: 5, pickup_note: "x" }).pickupNote === "");
check("a free-over of 0 or less is ignored", shippingRuleFromRow({ mode: "flat", flat_fee: 5, free_over: 0 }).freeOver === null);
check("the rule is active for a flat fee or for pickup alone, not otherwise", shippingRuleActive(flat) && shippingRuleActive(shippingRuleFromRow({ mode: "none", pickup_allowed: true })) && !shippingRuleActive(noShipping));

// ---- the sum (must match the sidecar SQL test: 24 -> 30.50, 60 -> free, pickup free, nothing to ship free)
check("a shipped order under the threshold pays the flat fee once", shippingFor(flat, 24, true, "ship") === 6.5);
check("at or above the threshold ships free", shippingFor(flat, 50, true, "ship") === 0 && shippingFor(flat, 60, true, "ship") === 0 && shippingFor(flat, 49.99, true, "ship") === 6.5);
check("pickup is free only when the shop offers it", shippingFor(flat, 24, true, "pickup") === 0 && shippingFor({ ...flat, pickupAllowed: false }, 24, true, "pickup") === 6.5);
check("a cart with nothing to ship pays no fee", shippingFor(flat, 24, false, "ship") === 0);
check("no rule means no fee", shippingFor(noShipping, 24, true, "ship") === 0);

// ---- the shopper's hint
check("the hint says how much more for free shipping", shippingHint(flat, 24, true, "ship", fmt) === "Add $26.00 more for free shipping.");
check("the hint confirms free shipping and free pickup", shippingHint(flat, 60, true, "ship", fmt) === "This order ships free." && shippingHint(flat, 24, true, "pickup", fmt) === "Pickup is free.");
check("no hint without a threshold, a rule, or something to ship", shippingHint({ ...flat, freeOver: null }, 24, true, "ship", fmt) === "" && shippingHint(noShipping, 24, true, "ship", fmt) === "" && shippingHint(flat, 24, false, "ship", fmt) === "");
check("the hint never shows a rounding tail", shippingHint(flat, 49.9, true, "ship", fmt) === "Add $0.10 more for free shipping.");

// ---- the owner's form
const ok = checkShippingForm({ mode: "flat", flatFee: " $6.5 ", freeOver: "50", pickupAllowed: true, pickupNote: " Saturdays " });
check("a good form becomes the exact server arguments", ok.ok && ok.args.mode_value === "flat" && ok.args.flat_fee_value === 6.5 && ok.args.free_over_value === 50 && ok.args.pickup_allowed_value === true && ok.args.pickup_note_value === "Saturdays");
check("a flat fee needs a number above 0 and at most 9999.99", ["", "0", "free", "10000"].every((flatFee) => !checkShippingForm({ ...blank, flatFee }).ok));
check("a typed free-over must be above 0; empty is fine", !checkShippingForm({ ...blank, flatFee: "5", freeOver: "0" }).ok && checkShippingForm({ ...blank, flatFee: "5", freeOver: " " }).ok);
const none = checkShippingForm({ mode: "none", flatFee: "junk", freeOver: "junk", pickupAllowed: false, pickupNote: "kept?" });
check("no fee ignores leftover boxes and drops a note without pickup", none.ok && none.args.flat_fee_value === 0 && none.args.free_over_value === null && none.args.pickup_note_value === null);
check("a long pickup note is refused in plain words", !checkShippingForm({ ...blank, mode: "none", pickupAllowed: true, pickupNote: "x".repeat(301) }).ok);
check("a saved rule fills the form back in", JSON.stringify(shippingFormFromRule(flat)) === JSON.stringify({ mode: "flat", flatFee: "6.50", freeOver: "50.00", pickupAllowed: true, pickupNote: "Saturdays at the market" }) && shippingFormFromRule(noShipping).flatFee === "");

// ---- the draft, and the rule that source never calls a function that only exists in a draft
const sql = read("docs/drafts/migrations/08_store_shipping_fee.sql");
const made = sql.match(/create or replace function public\.\w+/g) || [];
check("the draft adds five functions only (no table, policy, trigger or change to an existing function)", !/create (table|policy|trigger)|alter table|drop /i.test(sql) && made.length === 5 && made.every((m) => /nxq_store_shipping_rule|get_my_store_shipping|save_my_store_shipping|get_public_store_shipping|create_public_store_order_with_shipping/.test(m)));

const srcFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? srcFiles(`${dir}/${e.name}`) : /\.tsx?$/.test(e.name) ? [`${dir}/${e.name}`] : []);
const promoted = fs.readdirSync("supabase/migrations").some((f) => /store_shipping_fee/.test(f));
check("until the draft is a real migration, no page calls its functions (the screens wait in docs/drafts/patches)", promoted || (!srcFiles("src").some((f) => /get_public_store_shipping|create_public_store_order_with_shipping|get_my_store_shipping|save_my_store_shipping/.test(read(f))) && fs.existsSync("docs/drafts/patches/08_store_shipping_frontend.patch")));

// A parked patch goes stale every time the pages it touches change. This fails the moment that happens, so it is refreshed right away
// (re-apply with `git apply --3way`, fix, and write the new diff) instead of being found broken on the day it is needed.
if (!promoted) {
  const applies = spawnSync("git", ["apply", "--check", "docs/drafts/patches/08_store_shipping_frontend.patch"], { encoding: "utf8" });
  check("the parked screens patch still applies cleanly to the current pages", applies.status === 0, (applies.stderr || "").split("\n")[0]);
}

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll store shipping checks passed (offline).");
process.exit(failures ? 1 : 0);
