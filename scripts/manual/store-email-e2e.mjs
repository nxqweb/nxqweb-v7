// Scratch end-to-end check of an "order by email" store in a real browser (mocked backend). Run with the dev server up (see README.md).
import { createRequire } from "node:module";
const require = createRequire(process.env.PW_FROM || "/node-tools/node_modules/");
const { chromium } = require("playwright");
const v = (id, title, price, avail) => ({ id, title, price, available_quantity: avail, inventory_policy: "deny" });
const store = { store: { name: "Email Shop", slug: "x", currency: "USD" }, products: [
  { id: "p2", name: "Soap Bar", slug: "soap-bar", short_description: "Soap.", base_price: 9, image_url: null, image_urls: [], requires_shipping: true, variants: [v("v2", "Default", 9, 5)] },
] };
let failCount = 0; let orderCalls = 0;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : " " + extra}`); if (!cond) failCount++; };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" }).catch(() => chromium.launch());
const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
const page = await ctx.newPage();
const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
await page.route("**/rest/v1/rpc/**", async (route) => {
  const fn = route.request().url().split("/rpc/")[1].split("?")[0];
  if (fn === "create_public_stripe_ready_direct_payment_order") orderCalls++;
  const body = fn === "get_public_stripe_ready_commerce_storefront" ? store
    : fn === "get_public_store_order_mode" ? (process.env.NO_MODE ? null : { order_mode: "email", contact_email: "shop@example.com" })
    : fn === "get_public_store_accounts_status" ? { accounts_enabled: false } : {};
  if (fn === "get_public_store_order_mode" && process.env.NO_MODE) return route.fulfill({ status: 404, contentType: "application/json", headers: cors, body: JSON.stringify({ message: "function does not exist" }) });
  await route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(body) });
});
await page.route("**/auth/v1/**", (r) => r.fulfill({ status: 200, contentType: "application/json", headers: cors, body: "{}" }));
await page.goto(`${process.env.BASE_URL || "http://127.0.0.1:5199"}/store/x`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Add to cart" }).first().click();
await page.waitForTimeout(200);
if (process.env.NO_MODE) {
  ok("without the database feature the store keeps normal online ordering", (await page.getByRole("button", { name: /place order/i }).count()) === 1 && (await page.getByRole("button", { name: "Email my order" }).count()) === 0);
} else {
  ok("the header says orders go by email", (await page.locator(".store-header").innerText()).includes("Order by email"));
  ok("the button says Email my order", (await page.getByRole("button", { name: "Email my order" }).count()) === 1);
  await page.getByRole("button", { name: "Email my order" }).click();
  ok("empty details are refused kindly, no email panel", (await page.locator("[data-testid=email-order-panel]").count()) === 0 && (await page.locator(".auth-error").first().innerText()).includes("check the details"));
  await page.getByLabel(/^Name/).fill("Sam Customer");
  await page.getByLabel(/^Email/).fill("sam@example.com");
  await page.getByLabel(/^Shipping address/).fill("1 Main St");
  await page.getByRole("button", { name: "Email my order" }).click();
  await page.waitForSelector("[data-testid=email-order-panel]");
  const href = await page.locator("[data-testid=email-order-link]").getAttribute("href");
  ok("the link goes to the shop with the order in the body", href.startsWith("mailto:shop@example.com?subject=") && decodeURIComponent(href).includes("1 x Soap Bar - $9.00") && decodeURIComponent(href).includes("Ship to: 1 Main St"), href);
  ok("no online order was created", orderCalls === 0);
  await page.getByRole("button", { name: /\+|More Soap Bar/ }).first().click().catch(() => {});
  await page.waitForTimeout(200);
  ok("changing the cart removes the old email", (await page.locator("[data-testid=email-order-panel]").count()) === 0);
  await page.getByRole("button", { name: "Email my order" }).click();
  await page.getByRole("button", { name: "I sent it, clear my cart" }).click();
  await page.waitForTimeout(200);
  ok("clearing after sending empties the cart", (await page.locator(".store-cart-line").count()) === 0);
}
ok("no page errors happened", errors.length === 0, errors.join(" | "));
await browser.close();
console.log(failCount ? `\n${failCount} FAILED` : "\nAll browser checks passed");
process.exit(failCount ? 1 : 0);
