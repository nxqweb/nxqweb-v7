// Offline test: client-facing Commerce errors show only the reasons our own SQL raises, never Postgres internals,
// and every whitelisted reason really exists in the migrations (so the list cannot drift silently).
import fs from "node:fs";
import path from "node:path";
import { commerceReasonMessages, commerceRpcReason, withCommerceReason } from "../src/lib/commerceRpcReason.ts";

let failures = 0;
function check(name, ok, detail = "") { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); } }

const generic = "Product visibility could not be changed.";
check("known reason is shown before the generic text", withCommerceReason(generic, { message: "Product image must be a valid HTTPS URL." }) === `Product image must be a valid HTTPS URL. ${generic}`);
check("postgres internals stay hidden", withCommerceReason(generic, { message: 'new row for relation "products" violates check constraint "x"' }) === generic);
check("network errors stay hidden", withCommerceReason(generic, { message: "TypeError: Failed to fetch" }) === generic);
check("partial matches are not trusted", commerceRpcReason({ message: "Product price is invalid. extra detail from elsewhere" }) === null);
const imageRaw = "Every product image must be an existing image owned by this client workspace.";
const imageShown = withCommerceReason(generic, { message: imageRaw });
check("the image-ownership rejection (pasting a payment link in the image box) is explained in plain words", /not one of your uploaded photos/.test(imageShown) && /Photos page/.test(imageShown) && !/client workspace\./.test(imageShown.replace(/Payment links[^.]*\./, "")) && imageShown.endsWith(generic));
check("inherited object keys are not treated as reasons", commerceRpcReason({ message: "constructor" }) === null && commerceRpcReason({ message: "__proto__" }) === null && commerceRpcReason({ message: "toString" }) === null);
check("null and empty errors fall back to generic", withCommerceReason(generic, null) === generic && withCommerceReason(generic, {}) === generic && withCommerceReason(generic, { message: "" }) === generic);

const listed = Object.keys(commerceReasonMessages);
const migrationsDir = "supabase/migrations";
// Reviewed drafts (docs/drafts/migrations, not applied anywhere) count too: the local schema harness applies them and runs their tests.
const draftsDir = "docs/drafts/migrations";
const sqlFrom = (dir, keep) => fs.readdirSync(dir).filter(keep).map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join("\n");
const sql = sqlFrom(migrationsDir, (f) => f.endsWith(".sql")) + "\n" + sqlFrom(draftsDir, (f) => f.endsWith(".sql") && !f.endsWith(".test.sql"));
check("whitelist is not empty", listed.length >= 9, String(listed.length));
const missing = listed.filter((r) => !sql.includes(`raise exception '${r}'`));
check("every whitelisted reason is raised by a real migration or a reviewed draft", missing.length === 0, missing.join(" | "));

const page = fs.readFileSync("src/pages/ClientCommerceLiveStore.tsx", "utf8");
check("Live store uses the helper for the store save, product visibility and About/contact save errors", /We could not open your store\. Nothing was changed\./.test(page) && (page.match(/withCommerceReason\(/g) ?? []).length === 4 && /withCommerceReason\("We could not save how customers order\./.test(page) && /withCommerceReason\("Product visibility could not be changed\./.test(page) && /withCommerceReason\("Your About and contact details could not be saved\./.test(page));

check("the Live store page no longer has a product image box (it was a trap) and points to the Photos page", !/Primary product image/.test(page) && !/images\[product\.id\]/.test(page) && !/primary_image_url/.test(page) && /href="\/client\/commerce\/images"/.test(page) && /not here/.test(page));
check("the payment boxes no longer say Legacy or leave blank, and the page says only one payment link is needed", !/Legacy (PayPal|Venmo)/.test(page) && !/Leave blank for new stores/.test(page) && /You only need one payment link: Stripe, PayPal or Venmo/.test(page) && /https:\/\/paypal\.me\/yourname/.test(page) && /https:\/\/venmo\.com\/u\/yourname/.test(page));
check("image-ownership trigger really exists in a migration (so the explanation stays true)", sql.includes("Every product image must be an existing image owned by this client workspace."));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll commerce-rpc-reason checks passed (offline).");
process.exit(failures ? 1 : 0);
