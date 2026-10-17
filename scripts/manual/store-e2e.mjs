// Scratch end-to-end check of the public store in a real browser (mocked backend).
import { createRequire } from "node:module";
const require = createRequire(process.env.PW_FROM || "/node-tools/node_modules/");
const { chromium } = require("playwright");
const svg = (c) => `<svg xmlns='http://www.w3.org/2000/svg' width='400' height='400'><rect width='400' height='400' fill='${c}'/></svg>`;
const v = (id, title, price, avail, policy = "deny") => ({ id, title, price, available_quantity: avail, inventory_policy: policy });
const store = { store: { name: "Test Shop", slug: "x", currency: "USD", venmo_url: "https://venmo.com/u/example" }, products: [
  { id: "p1", name: "Vanilla Candle", slug: "vanilla-candle", short_description: "Soy.", description: "Soy candle.", base_price: 18, compare_at_price: 24, image_url: "https://img.example.test/a.svg", image_urls: ["https://img.example.test/a.svg", "https://img.example.test/b.svg"], requires_shipping: true, variants: [v("v1", "8 oz", 18, 2), v("v1b", "12 oz", 24, 5)] },
  { id: "p2", name: "Soap Bar", slug: "soap-bar", short_description: "Soap.", base_price: 9, image_url: null, image_urls: [], requires_shipping: true, variants: [v("v2", "Default", 9, 2)] },
  { id: "p3", name: "Gone", slug: "gone", short_description: "x", base_price: 5, image_url: null, image_urls: [], requires_shipping: true, variants: [v("v3", "Default", 5, 0)] },
] };
let orderPayload = null;
let failCount = 0;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : " " + extra}`); if (!cond) failCount++; };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" }).catch(() => chromium.launch());
const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
const page = await ctx.newPage();
const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
await page.route("https://img.example.test/**", (r) => r.fulfill({ status: 200, contentType: "image/svg+xml", body: svg("#c8a27a") }));
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
let orderError = null;
await page.route("**/rest/v1/rpc/**", async (route) => {
  const fn = route.request().url().split("/rpc/")[1].split("?")[0];
  if (fn === "create_public_stripe_ready_direct_payment_order") {
    orderPayload = JSON.parse(route.request().postData() || "{}");
    if (orderError) return route.fulfill({ status: 400, contentType: "application/json", headers: cors, body: JSON.stringify({ message: orderError }) });
    return route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify({ order_number: "NXQ-AB12CD34", total: 18, currency: "USD", venmo_url: "https://venmo.com/u/example" }) });
  }
  const body = fn === "get_public_stripe_ready_commerce_storefront" ? store : fn === "get_public_store_accounts_status" ? { accounts_enabled: false } : {};
  await route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(body) });
});
await page.route("**/auth/v1/**", (r) => r.fulfill({ status: 200, contentType: "application/json", headers: cors, body: "{}" }));
const base = `${process.env.BASE_URL || "http://127.0.0.1:5199"}/store/x`;
await page.goto(base, { waitUntil: "networkidle" });

ok("page title is the store name", (await page.title()) === "Test Shop");
ok("three product cards are shown", (await page.locator("[data-testid=store-product-card]").count()) === 3);
ok("the sold-out product has a disabled button", await page.locator("[data-testid=store-product-card]").nth(2).getByRole("button", { name: "Sold out" }).isDisabled());
// dialog open by name, keyboard
await page.locator("[data-testid=store-product-card]").first().getByRole("button", { name: "Vanilla Candle", exact: true }).click();
await page.waitForSelector("dialog[open]");
ok("the product opens in a dialog and the address bar gets the product link", (await page.evaluate(() => location.hash)) === "#product-vanilla-candle");
ok("gallery shows photo 1 of 2", (await page.locator(".store-gallery-main").getAttribute("alt")).includes("photo 1 of 2"));
await page.keyboard.press("ArrowRight");
ok("the right arrow key shows photo 2", (await page.locator(".store-gallery-main").getAttribute("alt")).includes("photo 2 of 2"));
await page.getByRole("button", { name: "Next photo" }).click();
ok("next wraps back to photo 1", (await page.locator(".store-gallery-main").getAttribute("alt")).includes("photo 1 of 2"));
ok("focus is inside the dialog (trapped)", await page.evaluate(() => document.querySelector("dialog").contains(document.activeElement)));
await page.keyboard.press("Escape");
await page.waitForTimeout(200);
ok("Escape closes the dialog and clears the address", (await page.locator("dialog[open]").count()) === 0 && (await page.evaluate(() => location.hash)) === "");
// choose option, add
await page.locator("[data-testid=store-product-card]").first().getByRole("button", { name: "Choose options" }).click();
await page.waitForSelector("dialog[open]");
await page.getByLabel(/12 oz/).check();
await page.getByRole("button", { name: "Add to cart" }).last().click();
await page.waitForTimeout(300);
ok("adding from the dialog closes it and puts the chosen option in the cart", (await page.locator("dialog[open]").count()) === 0 && (await page.locator(".store-cart-line").count()) === 1 && (await page.locator(".store-cart-line").first().innerText()).includes("12 oz"));
ok("a confirmation message is announced", (await page.locator("[data-testid=store-toast]").innerText()).includes("Added Vanilla Candle"));
// stock cap on soap (2 available)
const soap = page.locator("[data-testid=store-product-card]").nth(1).getByRole("button", { name: "Add to cart" });
await soap.click(); await soap.click(); await soap.click();
await page.waitForTimeout(200);
const soapLine = page.locator(".store-cart-line", { hasText: "Soap Bar" });
ok("the cart stops at the 2 in stock and says so", (await soapLine.locator(".store-qty").innerText()).includes("2") && (await page.locator("[data-testid=store-toast]").innerText()).includes("all we have in stock"));
ok("the plus button is disabled at the limit", await soapLine.getByRole("button", { name: /More Soap Bar/ }).isDisabled());
ok("the cart bar shows count and total (3 items, $42)", (await page.locator("[data-testid=store-cart-bar]").innerText()).includes("3 items") && (await page.locator("[data-testid=store-cart-bar]").innerText()).includes("$42.00"));
// reload keeps cart
await page.reload({ waitUntil: "networkidle" });
ok("the cart is still there after a reload", (await page.locator(".store-cart-line").count()) === 2);
// remove
await page.locator(".store-cart-line", { hasText: "Vanilla Candle" }).getByRole("button", { name: /Remove/ }).click();
ok("Remove takes a line out", (await page.locator(".store-cart-line").count()) === 1);
// deep link
await page.goto(base + "#product-soap-bar", { waitUntil: "networkidle" });
ok("a product link opens that product's dialog", (await page.locator("dialog[open] h2").innerText()) === "Soap Bar");
await page.keyboard.press("Escape");
// validation
await page.getByRole("button", { name: /place order/i }).click();
ok("empty details show messages and focus the first box", (await page.locator(".store-field-error").count()) === 3 && (await page.evaluate(() => document.activeElement?.id)) === "field-name");
await page.getByLabel(/^Name/).fill("Jo Shopper");
await page.getByLabel(/^Email/).fill("bad-email");
await page.getByRole("button", { name: /place order/i }).click();
ok("a bad email is explained", (await page.locator("#err-email").innerText()).includes("does not look right") && orderPayload === null);
await page.getByLabel(/^Email/).fill("jo@example.com");
await page.getByLabel(/^Shipping address/).fill("1 Main St");
orderError = 'duplicate key value violates unique constraint "commerce_orders_pkey"';
await page.getByRole("button", { name: /place order/i }).click();
await page.waitForTimeout(300);
ok("a technical server error becomes one calm sentence", (await page.locator(".auth-error").first().innerText()).includes("We could not place your order") && !(await page.content()).includes("duplicate key"));
orderError = null;
await page.getByRole("button", { name: /place order/i }).click();
await page.waitForTimeout(500);
ok("the order was sent with variant ids and quantities (no prices)", orderPayload && JSON.stringify(orderPayload.items_payload) === JSON.stringify([{ variant_id: "v2", quantity: 2 }]) && !JSON.stringify(orderPayload).includes("price"));
ok("the confirmation shows the number, next steps and a Venmo button; the cart is gone", (await page.locator("h2", { hasText: "NXQ-AB12CD34" }).count()) === 1 && (await page.locator("[data-testid=store-next-steps] li").count()) === 3 && (await page.getByRole("link", { name: "Pay with Venmo" }).count()) === 1);
ok("the cart is cleared from the browser after ordering", (await page.evaluate(() => localStorage.getItem("nxq-cart-v1-x"))) === null);
ok("no page errors happened", errors.length === 0, errors.join(" | "));
await browser.close();
console.log(failCount ? `\n${failCount} FAILED` : "\nAll browser checks passed");
process.exit(failCount ? 1 : 0);
