// Real-browser check of the "Request your website" flow (client flow v2, phase 1) against a MOCKED Supabase (every network call is intercepted).
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
const client = { id: "c-oak", business_name: "Oak Ridge Tree Service", status: "lead", billing_status: "not_configured", billing_provider: null, monthly_price: 100, notes: "", auth_user_id: user.id };
const setupCalls = []; const changeCalls = [];
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

let { page, ctx } = await newPage();
await page.goto(`${base}/client`, { waitUntil: "networkidle" });
await page.waitForSelector("[data-testid=request-website-card]", { timeout: 15000 });
const card = (await page.getByTestId("request-website-card").textContent()) || "";
ok("a new client sees a Request your website card with three steps, not a long form", /1\. Account/.test(card) && /2\. Plan/.test(card) && /3\. Request your website/.test(card) && (await page.locator("#industry").count()) === 0);
ok("the plan step says plainly that it is not active and who confirms it", /Not active yet/.test(card) && /confirms payment by hand/.test(card));
if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}/request-card.png`, fullPage: true });
await page.getByTestId("request-website-button").click();
await page.waitForSelector("#industry");
ok("opening the brief reuses signup: industry, services, area, phone and email are already filled in", (await page.inputValue("#industry")) === "Tree service" && /Tree removal/.test(await page.inputValue("#services")) && (await page.inputValue("#locations")) === "Chico, California" && (await page.inputValue("#business-phone")) === "(555) 010-2000" && (await page.inputValue("#business-email")) === "client@example.com");
await page.waitForTimeout(900);
ok("just opening the brief writes no draft (so the Request card is not lost on the next visit)", !(await page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith("nxq-brief-draft-v1")))));
const summary = (await page.getByTestId("signup-answers-summary").textContent()) || "";
ok("what they told us at signup is shown back, not asked again", /Homeowners/.test(summary) && /Request an estimate/.test(summary) && /Before and after job photos/.test(summary) && /More estimate requests/.test(summary));
ok("the look options exist with sensible defaults (NXQX recommends, SEO on, smooth scrolling on)", (await page.locator('input[name="website-colour-mode"]:checked').getAttribute("value")) === "recommend" && (await page.getByLabel(/Let search engines list my website/).isChecked()) && (await page.getByLabel(/Smooth scrolling/).isChecked()));
ok("it is clear the look is about the website, and Both explains the visitor switch", /about your website, not this portal/.test((await page.getByTestId("website-look").textContent()) || "") && /Visitors get a button to switch/.test((await page.getByTestId("website-look").textContent()) || ""));
ok("an unpaid client sees the plan notice and a locked send button", (await page.getByTestId("plan-not-active-notice").count()) === 1 && (await page.getByTestId("submit-locked-note").count()) === 1 && await page.getByRole("button", { name: /Request my website/ }).isDisabled());
await page.fill("#style-direction", "Clean, strong, dark with green");
await page.fill("#typed-signature", "Oak Owner");
await page.waitForTimeout(900);
if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}/request-brief.png`, fullPage: true });
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector("#industry", { timeout: 15000 });
ok("a reload keeps the draft: the brief reopens with what they typed", (await page.inputValue("#style-direction")) === "Clean, strong, dark with green");
ok("the signature is never kept in the draft", (await page.inputValue("#typed-signature")) === "");
ok("the draft is stored per client on this device only", await page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith("nxq-brief-draft-v1:c-oak"))));
await ctx.close();

// plan confirmed -> unlocked, full send
client.billing_status = "active";
({ page, ctx } = await newPage());
await page.goto(`${base}/client`, { waitUntil: "networkidle" });
await page.waitForSelector("[data-testid=request-website-card]", { timeout: 15000 });
ok("with an active plan the plan step shows Active", /Active\./.test((await page.getByTestId("request-website-card").textContent()) || ""));
await page.getByTestId("request-website-button").click();
await page.waitForSelector("#industry");
ok("no plan notice and the send button is unlocked", (await page.getByTestId("plan-not-active-notice").count()) === 0 && await page.getByRole("button", { name: "Request my website" }).isEnabled());
await page.getByRole("button", { name: "Request my website" }).click();
ok("sending with required answers missing is refused in plain words and sends nothing", /pages or sections/i.test((await page.locator(".notice-card.error").first().textContent()) || "") && setupCalls.length === 0);
await page.fill("#pages-needed", "Home, Services, My work, Contact");
await page.fill("#style-direction", "Clean, strong, dark with green");
await page.fill("#brand-notes", "Family run, local crews, honest quotes");
await page.getByLabel(/Both \(visitors can switch\)/).check();
await page.getByLabel("Warm earth").check();
await page.getByLabel("Soft cream").check();
await page.fill("#own-colours", "navy and rose pink, like my logo");
await page.getByLabel(/Let search engines list my website/).uncheck();
await page.locator(".agreement-box input[type=checkbox]").check();
await page.fill("#typed-signature", "Oak Owner");
await page.getByRole("button", { name: "Request my website" }).click();
await page.waitForTimeout(500);
const sent = setupCalls[0];
const report = sent?.target_setup_report || "";
ok("exactly one setup was sent", setupCalls.length === 1);
ok("the report starts the way the server requires and carries the signature and agreement", report.startsWith("NXQ WEB WEBSITE SETUP REPORT") && /\nTyped signature: Oak Owner\n/.test(report) && report.includes("Agreement accepted: Yes") && report.length >= 200 && report.length <= 30000);
ok("the style answer is written on ONE line (the database reads a single line; the old two-line form made the portal keep asking for desired_style)", report.includes("\nStyle direction: Clean, strong, dark with green\n") && !report.includes("Style direction:\nClean"));
ok("the report carries the chosen color theme, own colors and background", report.includes("\nWebsite colour theme: Warm earth\n") && report.includes("\nOwn colours: navy and rose pink, like my logo\n") && report.includes("\nWebsite background: Soft cream\n"));
ok("the report carries the chosen look options", report.includes("Website colour mode: Both (visitors can switch)") && report.includes("Search-engine setup (SEO): No") && report.includes("Smooth scrolling: Yes"));
ok("the report carries the signup answers so nothing is asked or lost twice", report.includes("Best customers: Homeowners") && report.includes("Main visitor action: Request an estimate") && report.includes("Proof to build around: Before and after job photos"));
ok("industry and area are passed to the server from the prefilled values", sent?.target_business_type === "Tree service" && sent?.target_service_area === "Chico, California");
ok("the draft is gone after a successful send", !(await page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith("nxq-brief-draft-v1")))));
await page.waitForSelector(".setup-complete-card", { timeout: 10000 });
ok("after sending, the form is out of the way and there is no redesign link before approval", (await page.locator("#industry").count()) === 0 && (await page.getByTestId("redesign-link").count()) === 0);
await ctx.close();

// approved -> redesign
client.status = "approved";
({ page, ctx } = await newPage());
await page.goto(`${base}/client`, { waitUntil: "networkidle" });
await page.waitForSelector("[data-testid=redesign-link]", { timeout: 15000 });
ok("once approved, a Redesign my website link appears", (await page.getByTestId("redesign-link").getAttribute("href")) === "/client/business/changes?mode=redesign");
await page.getByTestId("redesign-link").click();
await page.waitForSelector("[data-testid=redesign-panel]", { timeout: 15000 });
const send = page.getByRole("button", { name: "Send redesign request" });
ok("the redesign form opens straight from the link and sending is locked until something is described", await send.isDisabled());
await page.fill("#rd-change", "A gallery of my past jobs and a fresher look");
await page.fill("#rd-pages", "Home, My work, Contact");
await page.getByLabel(/^Light/).check();
const panelText = (await page.getByTestId("redesign-panel").textContent()) || "";
await send.click();
await page.waitForTimeout(500);
const change = changeCalls[0];
ok("a redesign is sent as one design change request with everything in the description", changeCalls.length === 1 && change.target_request_type === "design" && change.target_title === "Redesign my website" && /What to change: A gallery of my past jobs/.test(change.target_description) && /Website colour mode: Light/.test(change.target_description) && /Pages or sections wanted: Home, My work, Contact/.test(change.target_description));
ok("it says plainly that new pictures go on the Files card and that nothing is published directly", /Files card/.test(panelText) && /nothing is published directly/.test(panelText));
await ctx.close();

// a client on a custom price (for example Enterprise, arranged by hand) must never be rewritten to Starter by this form
client.status = "lead"; client.notes = ""; client.billing_status = "active"; client.monthly_price = 300;
const callsBeforeCustom = setupCalls.length;
({ page, ctx } = await newPage());
await page.goto(`${base}/client`, { waitUntil: "networkidle" });
await page.waitForSelector("[data-testid=request-website-card]", { timeout: 15000 });
await page.getByTestId("request-website-button").click();
await page.waitForSelector("#industry");
await page.fill("#pages-needed", "Home, Services, Contact");
await page.fill("#style-direction", "Clean, strong, dark with green");
await page.fill("#brand-notes", "Family run, local crews");
await page.locator(".agreement-box input[type=checkbox]").check();
await page.fill("#typed-signature", "Oak Owner");
await page.getByRole("button", { name: "Request my website" }).click();
await page.waitForTimeout(500);
ok("a custom-price client is stopped in plain words and nothing is sent (the server would rewrite them to Starter)", /arranged by hand/.test((await page.locator(".notice-card.error").first().textContent()) || "") && setupCalls.length === callsBeforeCustom);
await ctx.close();
client.monthly_price = 100; client.billing_status = "not_configured";

// phone widths
client.status = "lead"; client.notes = ""; client.billing_status = "not_configured";
for (const width of [390, 360]) {
  ({ page, ctx } = await newPage(width));
  await page.goto(`${base}/client`, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-testid=request-website-card]", { timeout: 15000 });
  ok(`no sideways scroll on the request card at ${width}px`, (await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0);
  await page.getByTestId("request-website-button").click();
  await page.waitForSelector("[data-testid=website-look]");
  ok(`no sideways scroll on the open brief at ${width}px`, (await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0);
  if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}/request-brief-${width}.png`, fullPage: true });
  await ctx.close();
}
// ---- other product lines share the same front door
for (const [family, titleRe, goesToSetup] of [["commerce", /Request your store/, true], ["booking", /Request your booking website/, false]]) {
  user.user_metadata.product_family_slug = family;
  ({ page, ctx } = await newPage(390));
  await page.goto(`${base}/client`, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-testid=request-website-card]", { timeout: 15000 });
  const text = (await page.getByTestId("request-website-card").textContent()) || "";
  ok(`${family}: the same three steps with ${family} words`, titleRe.test(text) && /1\. Account/.test(text) && /2\. Plan/.test(text) && /Not active yet/.test(text));
  const button = page.getByTestId("request-website-button");
  if (goesToSetup) {
    ok(`${family}: the button is a link to the store setup page, not the business brief`, (await button.evaluate((el) => el.tagName)) === "A" && (await button.getAttribute("href")) === "/client/commerce/setup" && (await page.locator("#industry").count()) === 0);
  } else {
    await button.click();
    await page.waitForSelector("#industry");
    ok(`${family}: the button opens the same brief as Business`, (await page.inputValue("#industry")) === "Tree service");
  }
  if (goesToSetup) {
    await page.goto(`${base}/client/commerce/setup`, { waitUntil: "networkidle" });
    await page.waitForSelector("text=Store basics", { timeout: 15000 });
    ok("commerce: a store not saved yet starts with the business name from signup", (await page.locator('label:has-text("Store name") input').inputValue()) === "Oak Ridge Tree Service");
    ok("commerce: and the products from signup", /Tree removal/.test(await page.locator('label:has-text("What products or services will you sell?") textarea').inputValue()));
  }
  ok(`${family}: no sideways scroll at 390px`, (await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0);
  await ctx.close();
}
delete user.user_metadata.product_family_slug;
ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));
await browser.close();
process.exit(failures ? 1 : 0);
