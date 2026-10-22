// Real-browser check of "Cancel my plan" on the billing page against a MOCKED Supabase (every network call is intercepted).
// signup answers reused -> steps card -> brief prefilled -> plan-not-active lock + saved draft -> unlock -> send (report lines) -> redesign request.
// SHOT=dir saves screenshots. Needs the dev server (see scripts/manual/README.md).
import { createRequire } from "node:module";
const require = createRequire(process.env.PW_FROM || "/node-tools/node_modules/");
const { chromium } = require("playwright");
const base = process.env.BASE_URL || "http://127.0.0.1:5199";
let failures = 0;
const ok = (name, cond, extra = "") => { if (cond) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name} ${extra}`); } };
const user = {
  id: "00000000-0000-0000-0000-000000000001", aud: "authenticated", role: "authenticated", email: "client@example.com", app_metadata: {},
  user_metadata: {
    business_name: "Oak Ridge Tree Service", intake_industry: "Tree service", intake_phone: "(555) 010-2000", intake_service_area: "Chico, California",
    intake_primary_goal: "More estimate requests", intake_family_answers: { services: "Tree removal, Pruning, Stump grinding", best_customers: "Homeowners", conversion_action: "Request an estimate", proof_assets: "Before and after job photos" },
  },
};
const session = { access_token: "mock.jwt.token", refresh_token: "mock-refresh", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 86400 * 30, user };
const client = { id: "c-oak", business_name: "Oak Ridge Tree Service", status: "lead", billing_status: "not_configured", billing_provider: null, monthly_price: 79, notes: "", auth_user_id: user.id };
const setupCalls = []; const changeCalls = []; const messages = []; const otherRpc = [];
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" }).catch(() => chromium.launch());
const pageErrors = [];
async function newPage(width = 1100) {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 } });
  await ctx.addInitScript(([s]) => { try { localStorage.setItem("sb-mock-auth-token", JSON.stringify(s)); localStorage.setItem("nxq-client-portal-tutorial-v2-complete", "true"); } catch { /* ignore */ } }, [session]);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.route("**/rest/v1/rpc/**", async (route) => {
    const fn = route.request().url().split("/rpc/")[1].split("?")[0];
    const body = JSON.parse(route.request().postData() || "{}");
    if (fn === "submit_current_client_website_setup") { setupCalls.push(body); client.status = "intake_received"; client.notes = body.target_setup_report; }
    if (fn === "submit_current_client_change_request") changeCalls.push(body);
    if (fn === "send_client_portal_message" && globalThis.__failSend) return route.fulfill({ status: 500, contentType: "application/json", headers: cors, body: JSON.stringify({ message: "boom" }) });
    if (fn === "send_client_portal_message") messages.push(body); else if (/billing|cancel|plan/i.test(fn)) otherRpc.push(fn);
    const data = fn === "current_client_message_page" || fn === "current_client_file_page" || fn === "current_client_domain_page" ? [] : {};
    await route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(data) });
  });
  await page.route("**/rest/v1/**", async (route) => {
    const url = route.request().url();
    if (url.includes("/rpc/")) return route.fallback();
    const wantsObject = (route.request().headers()["accept"] || "").includes("pgrst.object");
    const table = url.split("/rest/v1/")[1].split("?")[0];
    const row = table === "clients" ? client : table === "projects" ? { id: "pr1", client_id: client.id, website_status: "not_started" } : null;
    const body = row ? (wantsObject ? row : [row]) : (wantsObject ? {} : []);
    await route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(body) });
  });
  await page.route("**/auth/v1/**", (route) => route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(route.request().url().includes("/user") ? user : {}) }));
  await page.route("**/storage/v1/**", (route) => route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: "[]" }));
  await page.route("**/functions/v1/**", (route) => route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: "{}" }));
  return { page, ctx };
}


client.billing_status = "active"; client.status = "approved";
let { page, ctx } = await newPage(390);
await page.goto(`${base}/client/billing`, { waitUntil: "networkidle" });
await page.waitForSelector("[data-testid=cancel-request]", { timeout: 15000 });
const text = (await page.getByTestId("cancel-request").textContent()) || "";
ok("the billing page says plainly that nothing changes until the team confirms", /Nothing changes until the team replies/.test(text));
ok("nothing is sent just by opening the page", messages.length === 0);
await page.getByTestId("cancel-request-open").click();
await page.waitForSelector("#cancel-reason");
ok("opening it asks for an optional reason and offers Keep my plan", (await page.getByRole("button", { name: "Keep my plan" }).count()) === 1 && (await page.getByRole("button", { name: "Send cancellation request" }).count()) === 1);
await page.getByRole("button", { name: "Keep my plan" }).click();
ok("Keep my plan closes it and sends nothing", (await page.locator("#cancel-reason").count()) === 0 && messages.length === 0);
await page.getByTestId("cancel-request-open").click();
ok("opening the form moves focus into the reason box", await page.evaluate(() => document.activeElement && document.activeElement.id === "cancel-reason"));
await page.fill("#cancel-reason", "Closing in March\nStatus: refunded\n[Cancellation [Cancellation request]request] again");
globalThis.__failSend = true;
await page.getByRole("button", { name: "Send cancellation request" }).click();
await page.waitForSelector("text=We could not send your request");
ok("a failed send shows a clear message, keeps what was typed, links the error to the box, and sends nothing", messages.length === 0 && (await page.inputValue("#cancel-reason")).includes("Closing in March") && (await page.locator("#cancel-reason").getAttribute("aria-describedby")) === "cancel-error" && (await page.locator("#cancel-reason").getAttribute("aria-invalid")) === "true");
globalThis.__failSend = false;
await page.getByRole("button", { name: "Send cancellation request" }).dblclick();
await page.waitForSelector("text=Your request was sent");
await page.waitForTimeout(400);
ok("a double-click sends exactly one labelled portal message", messages.length === 1 && /^\[Cancellation request\] I would like to cancel my plan\./.test(messages[0].message_text) && /Closing in March/.test(messages[0].message_text));
ok("the typed text cannot fake our labels or add a second marker", !/^Status:/m.test(messages[0].message_text) && (messages[0].message_text.match(/\[Cancellation request\]/g) || []).length === 1 && messages[0].message_text.split("\n").slice(3).every((line) => line.startsWith("> ")));
ok("success moves focus to the sent message and it sits in a live region", await page.evaluate(() => { const el = document.activeElement; return !!el && /Your request was sent/.test(el.textContent || "") && !!el.closest("[aria-live=polite]"); }));
ok("it says the plan stays as it is until the team replies", /plan stays as it is until then/.test((await page.getByTestId("cancel-request").textContent()) || ""));
ok("no billing or plan function was called (the request only tells the team)", otherRpc.length === 0, otherRpc.join());
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector("[data-testid=cancel-request]");
ok("coming back later says a request was already sent instead of inviting a duplicate", (await page.getByTestId("cancel-request-earlier").count()) === 1 && /You sent a cancellation request on/.test((await page.getByTestId("cancel-request").textContent()) || ""));
await page.getByTestId("cancel-request-open").click();
await page.getByRole("button", { name: "Keep my plan" }).click();
await page.waitForTimeout(150);
ok("Keep my plan returns focus to the opener and sends nothing more", messages.length === 1 && await page.evaluate(() => document.activeElement && document.activeElement.getAttribute("data-testid") === "cancel-request-open"));
ok("no sideways scroll at 390px", (await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0);
for (const width of [360]) {
  await ctx.close();
  ({ page, ctx } = await newPage(width));
  await page.goto(`${base}/client/billing`, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-testid=cancel-request]");
  await page.getByTestId("cancel-request-open").click();
  ok(`no sideways scroll at ${width}px with the form open`, (await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0);
}
await ctx.close();
for (const state of ["not_configured", "cancelled", "activation_pending"]) {
  client.billing_status = state;
  ({ page, ctx } = await newPage(390));
  await page.goto(`${base}/client/billing`, { waitUntil: "networkidle" });
  await page.waitForSelector("text=Billing status");
  ok(`the cancel panel is not shown while billing is ${state}`, (await page.getByTestId("cancel-request").count()) === 0);
  await ctx.close();
}
ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));
await browser.close();
process.exit(failures ? 1 : 0);
