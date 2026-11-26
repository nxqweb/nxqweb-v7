// Offline test: the fixes from the three independent scans of 2026-10-17 (public store, signed-in pages, backend permissions) stay fixed.
// Source checks plus planted-bug controls (each control re-runs the same check on a deliberately broken copy and must see it fail).
import fs from "node:fs";
import { friendlyCheckoutError, genericCheckoutError } from "../src/lib/storeCatalog.ts";

let failures = 0;
function check(name, ok) { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}`); } }
const read = (p) => fs.readFileSync(p, "utf8");
const live = read("src/pages/ClientCommerceLiveStore.tsx");
const orders = read("src/pages/ClientCommerceOrders.tsx");
const portal = read("src/pages/ClientPortal.tsx");
const tour = read("src/components/ClientPortalTutorialOverlay.tsx");
const rewards = read("src/pages/ClientRewards.tsx");
const biz = read("src/pages/ClientBusinessDashboard.tsx");
const locs = read("src/pages/ClientBusinessLocations.tsx");
const store = read("src/pages/PublicCommerceStorefront.tsx");
const dialog = read("src/components/store/StoreProductDialog.tsx");
const rawFiles = ["src/pages/ClientBusinessLocations.tsx", "src/components/ClientPlanManagement.tsx", "src/components/ClientWebsiteSecurity.tsx", "src/pages/ClientValueHistory.tsx"].map((p) => [p, read(p)]);
const d09 = read("supabase/migrations/274_fix_duplicate_variant_oversell.sql");
const d10 = read("supabase/migrations/275_revoke_client_direct_table_writes.sql");

const c = (live, orders, portal, tour, rewards, biz, locs, store, dialog, raw, d09, d10) => ({
  liveKeepsTyping: /async function load\(\{ initial, resetFields \}/.test(live) && /if \(resetFields\) \{/.test(live) && (live.match(/load\(\{ initial: false, resetFields: false \}\)/g) || []).length === 2 && (live.match(/load\(\{ initial: true, resetFields: true \}\)/g) || []).length === 1 && /if \(initial\) \{\s*setLoading\(true\)/.test(live),
  liveNoOverlap: !/disabled=\{busy === "settings"\}/.test(live) && !/disabled=\{busy === "mode"\}/.test(live),
  ordersKeepTyping: /const previousServer = serverDrafts\.current;/.test(orders) && /typed && before && \(typed\.status !== before\.status/.test(orders),
  portalNotice: /if \(!options\.keepNotice\) setNotice\(""\)/.test(portal) && (portal.match(/loadClientPortalData\(\{ keepNotice: true \}\)/g) || []).length === 3,
  portalChatKeepsForms: /loadClientPortalData\(\{ keepNotice: true, keepForms: true \}\)/.test(portal) && /if \(!options\.keepForms\) setSelectedPackage/.test(portal),
  assistantRulesBox: /setAiCanAnswer\(value\); setAiNeverPromise\(""\); setEscalationRules\(""\);/.test(portal),
  tourStorageSafe: /function readTutorialDone\(\): boolean \{ try \{/.test(tour) && !/window\.localStorage\.getItem\(tutorialKey\) !== "true"/.test(tour) && !/^\s*window\.localStorage\.setItem/m.test(tour),
  rewardsNoFalseZero: /setLoadFailed\(true\)/.test(rewards) && /\{loaded && !loadFailed \? <>/.test(rewards) && /data-testid="rewards-load-failed"/.test(rewards),
  bizRedirect: /supabase\.auth\.getSession\(\)\s*;?\s*if \(!session\.data\.session\) \{ window\.location\.replace\("\/portal\/login"\)/.test(biz),
  billingConfirms: (locs.match(/window\.confirm\(/g) || []).length === 3,
  noRawErrors: raw.every(([, src]) => !/result\.error\.message|relatedError\.message|clientResult\.error\?\.message|overviewResult\.error\.message/.test(src.replace(/throw new Error\(overviewResult\.error\.message\)/, ""))) && !/Security overview could not be loaded: \$\{message\}/.test(raw[2][1]),
  storeInputsLimited: /maxLength=\{160\}/.test(store) && /maxLength=\{80\}/.test(store) && /maxLength=\{2000\}/.test(store) && /maxLength=\{1000\}/.test(store),
  storeErrorVisible: /const errorRef = useRef<HTMLDivElement>\(null\)/.test(store) && /errorRef\.current\?\.scrollIntoView/.test(store) && /role="alert" ref=\{errorRef\}/.test(store),
  dialogArrows: /closest\("input, select, textarea"\)\) return;/.test(dialog),
  d09: /seen_variants uuid\[\] := '\{\}'::uuid\[\]/.test(d09) && /if variant_uuid = any\(seen_variants\) then/.test(d09) && /seen_variants := seen_variants \|\| variant_uuid;/.test(d09) && /grant execute on function public\.create_public_direct_payment_order\(text,jsonb,jsonb\) to anon, authenticated;/.test(d09),
  d10: ["commerce_storefronts", "commerce_categories", "commerce_products", "commerce_product_variants", "commerce_inventory_movements", "commerce_customers", "commerce_carts", "commerce_cart_items", "commerce_orders", "commerce_order_items"].every((t) => new RegExp(`^revoke insert, update, delete on table public\\.${t} from authenticated;`, "m").test(d10)) && /^revoke insert on table public\.data_subject_requests from authenticated;/m.test(d10) && /^revoke insert on table public\.privacy_consents from authenticated;/m.test(d10),
});
const A = [live, orders, portal, tour, rewards, biz, locs, store, dialog, rawFiles, d09, d10];
const good = c(...A);
const plant = (index, from, to) => { const copy = [...A]; if (index === 9) copy[9] = copy[9].map(([p, s], i) => (i === 0 ? [p, s.replace(from, to)] : [p, s])); else copy[index] = copy[index].replace(from, to); return c(...copy); };

check("Live store: a refresh after a product toggle or ordering save keeps typed payment links, shows no 'Loading...' flash, and buttons cannot overlap", good.liveKeepsTyping && good.liveNoOverlap);
check("Orders: tracking numbers and notes typed on an order survive a refresh or saving another order", good.ordersKeepTyping);
check("Portal: success messages survive the reload that follows a save; a chat refresh never replaces what is typed in the setup form", good.portalNotice && good.portalChatKeepsForms);
check("Portal: the assistant-rules box no longer copies the other two answers back into itself", good.assistantRulesBox);
check("the tour's storage use cannot crash the portal when browser storage is blocked", good.tourStorageSafe);
check("Rewards shows no figures at all when the load fails (never '$0.00' for a real balance)", good.rewardsNoFalseZero);
check("/client/business sends signed-out visitors to the login page", good.bizRedirect);
check("adding, cancelling and closing paid locations each ask first", good.billingConfirms);
check("clients never see raw database text on the plan, security, locations and history pages", good.noRawErrors);
check("store checkout: input length limits match the database, a failed order scrolls into view, arrow keys on size options no longer flip the photo", good.storeInputsLimited && good.storeErrorVisible && good.dialogArrows);
check("checkout limit and rate-limit messages are plain words, and unknown database text still becomes the generic message", /too long/.test(friendlyCheckoutError("Customer name is required and must be 160 characters or fewer.")) && /too long/.test(friendlyCheckoutError("Order note must be 2000 characters or fewer.")) && /wait a little/.test(friendlyCheckoutError("Too many recent order attempts for this email. Please wait before trying again.")) && /busy/.test(friendlyCheckoutError("This store is receiving too many order attempts right now. Please try again shortly.")) && friendlyCheckoutError('duplicate key value violates unique constraint "x"') === genericCheckoutError);
check("migration 274 (oversell) changes only the duplicate-variant check and keeps the same grants; migration 275 revokes direct writes on all 10 Commerce tables and the two privacy tables", good.d09 && good.d10);

check("PLANTED BUG caught: a refresh overwrites typed payment links again", plant(0, "if (resetFields) {", "if (true) {").liveKeepsTyping === false);
check("PLANTED BUG caught: product toggle reloads with the loading flash", plant(0, "load({ initial: false, resetFields: false })", "load({ initial: true, resetFields: true })").liveKeepsTyping === false);
check("PLANTED BUG caught: order drafts are rebuilt from the server again", plant(1, "const previousServer = serverDrafts.current;", "const previousServer: Record<string, never> = {};").ordersKeepTyping === false);
check("PLANTED BUG caught: a save reload erases the success message", plant(2, 'if (!options.keepNotice) setNotice("")', 'setNotice("")').portalNotice === false);
check("PLANTED BUG caught: the chat refresh replaces typed setup answers", plant(2, "loadClientPortalData({ keepNotice: true, keepForms: true })", "loadClientPortalData({ keepNotice: true })").portalChatKeepsForms === false);
check("PLANTED BUG caught: storage access can crash the tour", plant(3, "function readTutorialDone(): boolean { try {", "function readTutorialDone(): boolean { {").tourStorageSafe === false);
check("PLANTED BUG caught: Rewards shows figures after a failed load", plant(4, "{loaded && !loadFailed ? <>", "{loaded ? <>").rewardsNoFalseZero === false);
check("PLANTED BUG caught: a location add-on is added without asking", plant(6, 'window.confirm("Add the paid location add-on?', '("Add the paid location add-on?').billingConfirms === false);
check("PLANTED BUG caught: raw database text is shown again", plant(9, 'setError("The location add-on could not be enabled right now. Nothing was changed. Please try again or contact us.")', "setError(result.error.message)").noRawErrors === false);
check("PLANTED BUG caught: the order note has no length limit", plant(7, "maxLength={2000}", "").storeInputsLimited === false);
check("PLANTED BUG caught: arrow keys flip photos while choosing an option", plant(8, 'closest("input, select, textarea")) return;', 'closest("nothing")) return;').dialogArrows === false);
check("PLANTED BUG caught: migration 274 stops remembering variants", plant(10, "seen_variants := seen_variants || variant_uuid;", "").d09 === false);
check("PLANTED BUG caught: migration 275 forgets a table", plant(11, "revoke insert, update, delete on table public.commerce_order_items from authenticated;", "").d10 === false);

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll scan-fix checks passed (offline).");
process.exit(failures ? 1 : 0);
