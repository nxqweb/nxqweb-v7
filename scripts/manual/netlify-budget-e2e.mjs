// Real-browser check of the owner's Netlify build limit screen (/owner/netlify-budget) against a MOCKED Supabase (every network call is intercepted, nothing real is contacted).
// Start the dev server first, see scripts/manual/README.md "Run". SHOT=dir saves screenshots. AXE=path adds an axe-core scan.
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(process.env.PW_FROM || "/node-tools/node_modules/");
const { chromium } = require("playwright");
const base = process.env.BASE_URL || "http://127.0.0.1:5199";
const axeSource = process.env.AXE && fs.existsSync(process.env.AXE) ? fs.readFileSync(process.env.AXE, "utf8") : "";
let failures = 0;
const ok = (name, cond, extra = "") => { if (cond) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name} ${extra}`); } };
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" }).catch(() => chromium.launch());
const user = { id: "00000000-0000-0000-0000-0000000000aa", aud: "authenticated", role: "authenticated", email: "owner@example.com", app_metadata: {}, user_metadata: {} };
const session = { access_token: "mock.jwt.token", refresh_token: "mock-refresh", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 86400 * 30, user };

// One in-memory "database row" so a save is visible on the next load, like the real thing.
const db = { enabled: true, emergency_stop: false, max_builds_per_cycle: 4, max_qa_builds_per_cycle: 2, reserved_builds: 3, reserved_qa_builds: 2 };
const sent = [];
function statusBody() {
  return { settings: { singleton: true, enabled: db.enabled, emergency_stop: db.emergency_stop, billing_cycle_anchor_day: 23, max_builds_per_cycle: db.max_builds_per_cycle, max_qa_builds_per_cycle: db.max_qa_builds_per_cycle },
    cycle_start: "2026-10-23", reserved_builds: db.reserved_builds, reserved_qa_builds: db.reserved_qa_builds };
}

const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } });
await ctx.addInitScript(([x]) => { try { localStorage.setItem("sb-mock-auth-token", JSON.stringify(x)); } catch { /* ignore */ } }, [session]);
const page = await ctx.newPage();
const dialogs = [];
let acceptDialogs = true;
page.on("dialog", async (d) => { dialogs.push(d.message()); if (acceptDialogs) await d.accept(); else await d.dismiss(); });
await page.route("**/rest/v1/rpc/**", (route) => {
  const fn = route.request().url().split("/rpc/")[1].split("?")[0];
  let body = null;
  if (fn === "owner_netlify_budget_status") body = statusBody();
  if (fn === "owner_update_netlify_budget_settings") {
    const args = route.request().postDataJSON(); sent.push(args);
    db.enabled = args.target_enabled; db.emergency_stop = args.target_emergency_stop; db.max_builds_per_cycle = args.target_max_builds_per_cycle; db.max_qa_builds_per_cycle = args.target_max_qa_builds_per_cycle;
    body = { ok: true };
  }
  route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(body) });
});
await page.route("**/rest/v1/**", (route) => route.request().url().includes("/rpc/") ? route.fallback() : route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: route.request().url().includes("/owner_users") ? JSON.stringify([{ id: "o1", auth_user_id: user.id }]) : "[]" }));
await page.route("**/auth/v1/**", (route) => route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(user) }));

await page.goto(`${base}/owner/netlify-budget`, { waitUntil: "networkidle" }); await page.waitForTimeout(500);
const counts = await page.getByTestId("budget-counts").innerText();
ok("shows this cycle's start date and the counted builds against the limits", /Builds counted: 3 of 4 allowed, so 1 left/.test(counts) && /2 of 2 allowed/.test(counts) && (await page.locator("h2").first().innerText()).includes("2026-10-23"));
ok("shows that QA builds left cannot exceed the total left (here 0 QA builds, so 0 approve runs)", /0 test builds are left/.test(counts) && /about 0 to 0 more approve runs/.test(counts));
ok("the form starts with the saved limits", (await page.getByLabel(/Builds allowed this cycle/).inputValue()) === "4" && (await page.getByLabel(/test \(QA\) builds allowed/).inputValue()) === "2");
ok("no sideways scroll at 390px", !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}/budget-before.png`, fullPage: true });

// a QA limit above the total is flagged and Save is disabled
await page.getByLabel(/Builds allowed this cycle/).fill("12"); await page.getByLabel(/test \(QA\) builds allowed/).fill("20"); await page.waitForTimeout(150);
ok("a QA limit above the cycle limit is flagged in plain words and Save is disabled", /cannot be higher/.test(await page.getByTestId("budget-problem").innerText()) && (await page.getByRole("button", { name: "Save limits" }).isDisabled()));
await page.getByLabel(/Builds allowed this cycle/).fill("101"); await page.waitForTimeout(150);
ok("more than 100 is flagged", /0 to 100/.test(await page.getByTestId("budget-problem").innerText()));
await page.getByLabel(/Builds allowed this cycle/).fill(""); await page.waitForTimeout(150);
ok("an empty box is flagged, not saved as zero", (await page.getByTestId("budget-problem").count()) === 1 && (await page.getByRole("button", { name: "Save limits" }).isDisabled()));

// cancelling the confirm box saves nothing
await page.getByLabel(/Builds allowed this cycle/).fill("12"); await page.getByLabel(/test \(QA\) builds allowed/).fill("12"); await page.waitForTimeout(150);
acceptDialogs = false;
await page.getByRole("button", { name: "Save limits" }).click(); await page.waitForTimeout(300);
ok("the confirm box lists exactly what changes, and cancelling sends nothing", dialogs.length === 1 && /4 -> 12/.test(dialogs[0]) && /2 -> 12/.test(dialogs[0]) && sent.length === 0);

// accepting saves the exact arguments and the screen reloads the new numbers
acceptDialogs = true;
await page.getByRole("button", { name: "Save limits" }).click(); await page.waitForTimeout(500);
ok("accepting sends the exact four arguments", sent.length === 1 && JSON.stringify(sent[0]) === JSON.stringify({ target_enabled: true, target_emergency_stop: false, target_max_builds_per_cycle: 12, target_max_qa_builds_per_cycle: 12 }));
const after = await page.getByTestId("budget-counts").innerText();
ok("the screen then shows the saved numbers and the room for more approve runs", /3 of 12 allowed, so 9 left/.test(after) && /10 test builds are left/.test(after) === false && /9 test builds are left/.test(after) && /about 3 to 4 more approve runs/.test(after));
ok("nothing to save means no request: saving again with no change says so", await (async () => { const n = sent.length; await page.getByRole("button", { name: "Save limits" }).click(); await page.waitForTimeout(300); return sent.length === n && (await page.getByText("Nothing changed.").count()) === 1; })());

// emergency stop is spelled out
await page.getByLabel(/Emergency stop/).check(); await page.waitForTimeout(100);
await page.getByRole("button", { name: "Save limits" }).click(); await page.waitForTimeout(400);
ok("turning the emergency stop on warns that real clients are affected", /Emergency stop: OFF -> ON/.test(dialogs.at(-1)) && /real clients/.test(dialogs.at(-1)));
ok("and the screen then says new builds are refused", /Emergency stop is ON: every new build is refused/.test(await page.getByTestId("budget-counts").innerText()));
if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}/budget-after.png`, fullPage: true });

if (axeSource) {
  await page.waitForTimeout(600); await page.evaluate(axeSource);
  const v = await page.evaluate(async () => (await window.axe.run(document, { resultTypes: ["violations"] })).violations.filter((x) => ["serious", "critical"].includes(x.impact)).map((x) => `${x.id}:${x.nodes.length}`));
  ok("axe: no serious or critical accessibility issues", v.length === 0, v.join(","));
}
await ctx.close();
await browser.close();
if (failures) { console.log(`\n${failures} check(s) FAILED`); process.exit(1); }
console.log("\nAll checks passed.");
