// Scratch end-to-end check of the Rewards page in a real browser (mocked backend).
import { createRequire } from "node:module";
const require = createRequire(process.env.PW_FROM || "/node-tools/node_modules/");
const { chromium } = require("playwright");
const base = process.env.BASE_URL || "http://127.0.0.1:5199";
const user = { id: "00000000-0000-0000-0000-000000000001", aud: "authenticated", role: "authenticated", email: "client@example.com", app_metadata: {}, user_metadata: { business_name: "Light of the world candles and soap", intake_family_answers: { services: "Candles and soap" } }, created_at: "2026-10-15T00:00:00Z" };
const session = { access_token: "mock.jwt.token", refresh_token: "mock-refresh", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 86400 * 30, user };
const client = { id: "1d6f34f7", business_name: "Light of the world candles and soap", status: "approved", billing_status: "active", billing_provider: "manual", monthly_price: 150, notes: "", auth_user_id: user.id, product_family_slug: "commerce", product_tier_key: "intelligence" };
const product = { id: "p1", name: "Vanilla Bean Candle", slug: "vanilla", status: "draft", base_price: 18, image_url: null, short_description: "Hand-poured soy candle", variants: [{ id: "v1", title: "8 oz", price: 18, sku: "VAN-8", on_hand: 10, available_quantity: 10 }], image_urls: [] };
const storefront = { id: "sf1", store_name: "Light of the world candles and soap", store_slug: "light-of-the-world-abc", status: "active", payment_mode: "live", settings: { venmo_url: "https://venmo.com/u/example" } };
const rpc = {
  ensure_my_commerce_storefront: "sf1",
  get_my_commerce_catalog: { summary: { products: 1, active_products: 0, draft_products: 1, categories: 1, low_stock: 0, variants: 1 }, storefront, products: [product], categories: [{ id: "c1", name: "Candles", slug: "candles" }], inventory: [] },
  get_my_commerce_intake: { status: "draft", store_name: "Light of the world candles and soap", business_model: "physical_products", inventory_method: "track_inventory", website_transition_mode: "not_selected", fulfillment_methods: [] },
  get_my_stripe_ready_storefront_settings: { store: { name: "Light of the world candles and soap", slug: "light-of-the-world-abc", currency: "USD" }, status: "active", public_url: "/store/light-of-the-world-abc", stripe_payment_link: "", paypal_url: "", venmo_url: "https://venmo.com/u/example", payment_note: "", products: [{ ...product, status: "active" }] },
  get_my_commerce_orders: { summary: { orders: 2, new_orders: 1, open_orders: 2, completed_orders: 0 }, orders: [
    { id: "o1", order_number: "NXQ-AB12CD34", customer_name: "Jordan Example With A Longer Name", customer_email: "jordan.example.long.address@example.com", currency: "USD", subtotal: 18, total: 18, payment_status: "pending", fulfillment_status: "new", tracking_number: null, fulfillment_note: null, is_test: false, placed_at: "2026-10-16T12:00:00Z", updated_at: "2026-10-16T12:00:00Z", items: [{ id: "i1", name: "Vanilla Bean Candle", variant_title: "8 oz", quantity: 1, unit_price: 18, line_total: 18 }], events: [] },
    { id: "o2", order_number: "NXQ-EF56GH78", customer_name: "Sam Test", customer_email: "sam@example.com", currency: "USD", subtotal: 12, total: 12, payment_status: "paid", fulfillment_status: "processing", tracking_number: null, fulfillment_note: null, is_test: false, placed_at: "2026-10-16T13:00:00Z", updated_at: "2026-10-16T13:00:00Z", items: [], events: [] } ] },
  get_my_commerce_product_images: { image_urls: [] },
  get_public_store_accounts_status: { accounts_enabled: false },
};
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" }).catch(() => chromium.launch());
rpc.current_client_message_page = [];
let failCount = 0; const sent = []; const claims = []; let dash = { profile: { referral_code: "NXQ1A2B3C4D5", status: "active" }, program: { enabled: true, reward: 10, first_month_discount: 10, minimum_payment: 10, hold_days: 14, grant_enrollment_open: false, grant_monthly_cost_cap: 50 }, balances: { pending: 10, available: 20, applied: 5 }, referrals: [{ id: "r1", status: "holding", attributed_at: "2026-10-10T00:00:00Z", hold_until: "2026-11-01T00:00:00Z", risk_score: 77 }, { id: "r2", status: "blocked", attributed_at: "2026-10-11T00:00:00Z", risk_score: 99 }], ledger: [{ id: "l1", entry_type: "earned", status: "available", amount: 10, remaining_amount: 10, description: "Qualified referral reward", created_at: "2026-10-12T00:00:00Z" }], grant_application: null, grant_award: null };
const ok = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : " " + extra}`); if (!cond) failCount++; };
const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
const page = await ctx.newPage();
const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
await page.addInitScript(([s]) => { try { localStorage.setItem("sb-mock-auth-token", JSON.stringify(s)); } catch {} }, [session]);
let sendFails = false;
  await page.route("**/rest/v1/rpc/**", async (route) => { const fn = route.request().url().split("/rpc/")[1].split("?")[0]; if (fn === "nxq_referral_dashboard") { return route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(dash) }); } if (fn === "nxq_claim_referral") { claims.push(JSON.parse(route.request().postData() || "{}").target_referral_code); return route.fulfill({ status: 400, contentType: "application/json", headers: cors, body: JSON.stringify({ message: "duplicate key value violates unique constraint secret_internal" }) }); } await route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(fn in rpc ? rpc[fn] : {}) }); });
  await page.route("**/rest/v1/**", async (route) => { const url = route.request().url(); if (url.includes("/rpc/")) return route.fallback(); const wantsObject = (route.request().headers()["accept"] || "").includes("pgrst.object"); const table = url.split("/rest/v1/")[1].split("?")[0]; const row = table === "clients" ? client : table === "projects" ? { id: "pr1", client_id: client.id, website_status: "not_started" } : {}; await route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(wantsObject ? row : [row]) }); });
  await page.route("**/auth/v1/**", (route) => route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(route.request().url().includes("/user") ? user : {}) }));
  await page.route("**/storage/v1/**", (route) => route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: "[]" }));
  await page.route("**/functions/v1/**", (route) => route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: "{}" }));

await page.addInitScript(() => { try { localStorage.setItem("nxq-client-portal-tutorial-v2-complete", "true"); } catch {} });
await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base }).catch(() => {});
await page.goto(base + "/client/rewards", { waitUntil: "networkidle" });
await page.waitForSelector("[data-testid=rewards-invite]");
const text = await page.locator("main").innerText();
ok("the three steps use the program's numbers", text.includes("$10 off") && text.includes("14-day review"));
ok("the link is the signup link with the code", (await page.locator("#rewards-link").inputValue()).endsWith("/portal/signup?ref=NXQ1A2B3C4D5"));
ok("friends read as sentences, with no risk score anywhere", text.includes("Paid. Your reward is on a short review and will be ready after") && text.includes("Not eligible.") && !/risk|77|99/i.test(text));
ok("credit has plain labels", text.includes("Ready to use $20.00") && text.includes("Waiting for review $10.00") && text.includes("Already used $5.00"));
await page.getByRole("button", { name: "Copy link" }).click();
await page.waitForTimeout(200);
ok("copy gives feedback and really copies the link", (await page.getByRole("button", { name: "Link copied" }).count()) === 1 && (await page.evaluate(() => navigator.clipboard.readText()).catch(() => "")).endsWith("ref=NXQ1A2B3C4D5"));
await page.getByText("Did a friend give you a code?").click();
await page.getByLabel("Referral code").fill("nxq9z9z9z9z9");
await page.getByRole("button", { name: "Apply code" }).click();
await page.waitForTimeout(300);
const err = await page.locator("[role=alert]").first().innerText();
ok("a technical database error becomes one calm line", err.includes("Something went wrong") && !err.includes("duplicate") && !(await page.content()).includes("secret_internal") && claims[0] === "NXQ9Z9Z9Z9Z9", err);
dash = { ...dash, program: { ...dash.program, enabled: false } };
await page.getByRole("button", { name: "Refresh" }).click();
await page.waitForTimeout(300);
ok("a closed program says so kindly", (await page.locator("main").innerText()).includes("Referrals are not open yet. Your link is saved"));
ok("no page errors happened", errors.length === 0, errors.join(" | "));
await browser.close();
console.log(failCount ? `\n${failCount} FAILED` : "\nAll browser checks passed");
process.exit(failCount ? 1 : 0);
