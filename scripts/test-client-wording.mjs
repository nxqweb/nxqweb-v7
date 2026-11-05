// Offline test: the main Commerce pages speak plain words to a shop owner. Internal terms (protected workflow, safety gates, bypass,
// "previously verified state") confused a first client and say nothing useful, so they must not come back.
import fs from "node:fs";

let failures = 0;
function check(name, ok, detail = "") { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); } }

const pages = {
  live: "src/pages/ClientCommerceLiveStore.tsx",
  orders: "src/pages/ClientCommerceOrders.tsx",
  products: "src/pages/ClientCommerceProducts.tsx",
  images: "src/pages/ClientCommerceProductImages.tsx",
  dashboard: "src/pages/ClientCommerceDashboard.tsx",
  setup: "src/pages/ClientCommerceSetup.tsx",
};
const src = Object.fromEntries(Object.entries(pages).map(([k, p]) => [k, fs.readFileSync(p, "utf8")]));

const banned = [/previously verified/i, /verified order records/i, /All verified protected/i, /No verified orders/i, /protected test/i, /protected checkout/i, /protected (Commerce|product) workflow/i,
  /safety gates/i, /launch gates/i, /bypass/i, /production approvals/i, /separate protected actions/i, /separate and protected/i, /publish and approval gates/i];
for (const [name, text] of Object.entries(src)) {
  const hits = banned.filter((re) => re.test(text)).map((re) => String(re));
  check(`${name} page has no internal jargon`, hits.length === 0, hits.join(" "));
}

check("opening the store says so in plain words", /Your store is open\. Customers can now order from it\./.test(src.live) && /We could not open your store\. Nothing was changed\./.test(src.live) && /We could not save your store settings\. Nothing was changed\./.test(src.live));
check("the Live store page says what it is for and what a product needs to be seen", /Set your store name and payment link, open your store, and choose which products customers can see\./.test(src.live) && /A product stays hidden until you press Make visible\./.test(src.live));
check("orders speak of practice orders, not protected test orders", /Create practice order/.test(src.orders) && /Creating practice order\.\.\./.test(src.orders) && /No orders yet\. Place a practice order from your store/.test(src.orders) && /See your orders, confirm payments when the money arrives, and update shipping\./.test(src.orders));
check("products and photos say they stay private until Make visible", /A product only shows in your store after you press Make visible on the Live store page\./.test(src.products) && /Photos stay private until you make the product visible on the Live store page\./.test(src.images));
check("the dashboard checkout card and the setup notice are plain", /<h2>Test your checkout<\/h2>/.test(src.dashboard) && /Open checkout test/.test(src.dashboard) && /does not publish your store, change your plan, or charge anything\./.test(src.setup));
check("the real safety behaviour did not change: nothing here removes the confirmations or the payment-confirmation step", /window\.confirm\(/.test(src.live) && /Confirm payment received/.test(src.orders) && /Never enter a Stripe secret key/.test(src.live));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll client-wording checks passed (offline).");
process.exit(failures ? 1 : 0);
