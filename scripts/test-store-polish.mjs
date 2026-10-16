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

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll store-polish checks passed (offline).");
process.exit(failures ? 1 : 0);
