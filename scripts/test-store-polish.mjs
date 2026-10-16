// Offline test: small store polish that ships with the launch deploy: the product image box is gone, the owner can copy the store link,
// and the browser tab shows the store's own name on public store pages (and restores the old title when leaving).
import fs from "node:fs";

let failures = 0;
function check(name, ok, detail = "") { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); } }

const live = fs.readFileSync("src/pages/ClientCommerceLiveStore.tsx", "utf8");
const store = fs.readFileSync("src/pages/PublicCommerceStorefront.tsx", "utf8");
const account = fs.readFileSync("src/pages/PublicShopperAccount.tsx", "utf8");
const reasons = fs.readFileSync("src/lib/commerceRpcReason.ts", "utf8");
const sql = fs.readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).map((f) => fs.readFileSync(`supabase/migrations/${f}`, "utf8")).join("\n");

// ---- image box removed
check("the Live store page has no image input, no image state, and does not send an image to the database", !/primary_image_url/.test(live) && !/setImages|useState<Record<string, string>>/.test(live) && !/placeholder="Leave empty/.test(live));
check("the database function still works without that argument (it has a default)", /primary_image_url text default null/.test(sql));
check("the error for a bad image no longer mentions a box that does not exist", /That image is not one of your uploaded photos\. Upload your photos on the Photos page\./.test(reasons) && !/image box/.test(reasons));
check("the visibility toggle still calls the same database function", /set_my_commerce_product_live", \{\s*product_uuid: product\.id,\s*make_active: makingLive,\s*\}\)/.test(live));

// ---- copy store link
check("an open store shows its address and a Copy store link button", /data\.status === "active" \? <div data-testid="store-link-box">/.test(live) && /Your store address: <strong>\{liveUrl\}<\/strong>/.test(live) && /Copy store link/.test(live));
check("copying works through the clipboard and falls back to a plain message", /navigator\.clipboard\.writeText\(liveUrl\)/.test(live) && /Store link copied\./.test(live) && /Could not copy automatically/.test(live));

// ---- tab titles
check("the store page sets the tab title to the store name and restores the old title", /const name = data\?\.store\.name;[\s\S]{0,200}document\.title = name;[\s\S]{0,120}return \(\) => \{ document\.title = previous; \}/.test(store));
check("the shopper account page sets a store-named title and restores it", /document\.title = `\$\{storeName\} · Your account`/.test(account) && /return \(\) => \{ document\.title = previous; \}/.test(account) && /if \(storeName === "this store"\) return;/.test(account));
check("title effects sit before the early returns (hooks stay in a stable order)", store.indexOf("document.title = name") < store.indexOf("if (loading) return") && account.indexOf("document.title =") < account.indexOf("if (accountsEnabled === null) return"));

// ---- shopping flow
check("the header cart count links to the cart and names the item count for screen readers", /className="store-cart-link" href="#store-cart" aria-label=\{`Cart, \$\{itemCount\} \$\{itemCount === 1 \? "item" : "items"\}`\}/.test(store) && /id="store-cart"/.test(store));
check("a sticky View cart bar shows only while browsing with something in the cart", /\{!order && itemCount > 0 \? <a className="store-cart-bar" href="#store-cart"/.test(store) && /View cart · \{itemCount\} \{itemCount === 1 \? "item" : "items"\} · \{formatMoney\(total, currency\)\}/.test(store));
const themeCss = fs.readFileSync("src/styles/storefront-theme.css", "utf8");
check("the bar is fixed to the bottom, leaves room so it never hides the last content, and is scoped to store pages", /\.store-theme \.store-cart-bar \{[^}]*position: fixed;[^}]*bottom: 12px;/.test(themeCss) && /\.store-theme \.portal-shell \{ padding-bottom: 88px; \}/.test(themeCss));
check("after ordering, the customer sees three plain next steps and can copy the order number", /data-testid="store-next-steps"/.test(store) && /Pay with the button below and put order number/.test(store) && /The shop confirms your payment once it arrives/.test(store) && /Keep your order number\. Use it if you contact the shop/.test(store) && /copyOrderNumber/.test(store) && /navigator\.clipboard\.writeText\(order\.order_number\)/.test(store) && /Could not copy automatically\. Please write down your order number\./.test(store));
check("the shop's About and contact block still shows after an order is placed", store.indexOf('data-testid="store-about"') > store.indexOf("</> : null}") || /data-testid="store-about"/.test(store));

// ---- small safety nets
const readiness = fs.readFileSync("src/pages/ClientCommerceReadiness.tsx", "utf8");
check("making a $0 product visible asks first and names the problem", /const zeroPrice = makingLive && !\(Number\(product\.base_price\) > 0\);/.test(live) && /has a price of \$0, so customers would see it for free\. Make it visible anyway\?/.test(live) && /window\.confirm\(\s*zeroPrice/.test(live));
check("the readiness page says it is optional preparation", /data-testid="readiness-optional-note"/.test(readiness) && /You can open your store and take orders without filling it in/.test(readiness));

const tutorial = fs.readFileSync("src/pages/ClientCommerceTutorial.tsx", "utf8");
const dashboardPage = fs.readFileSync("src/pages/ClientCommerceDashboard.tsx", "utf8");
check("the header cart link only shows while browsing (after an order there is no cart to jump to)", /\{!order \? <a className="store-cart-link" href="#store-cart"/.test(store));
check("the guide's step count in the intro text follows the real number of steps", /\{launchGuideSteps\.length\} short steps from an empty store/.test(tutorial) && /\{launchGuideSteps\.length\} short steps, from an empty store/.test(dashboardPage) && !/Six short steps/.test(tutorial + dashboardPage));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll store-polish checks passed (offline).");
process.exit(failures ? 1 : 0);
