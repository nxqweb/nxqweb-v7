// Guards the owner "Stripe customer links" screen on /owner/billing (calls migration 261's owner-only functions).
import fs from "node:fs";

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`PASS  ${name}`);
  else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); }
}
const read = (file) => fs.readFileSync(file, "utf8");
const ui = read("src/components/OwnerStripeCustomerLinks.tsx");
const page = read("src/pages/OwnerBillingLifecycle.tsx");
const migration = read("supabase/migrations/261_owner_link_stripe_customer.sql");

check("the screen is mounted on the owner billing page", page.includes("<OwnerStripeCustomerLinks") && page.includes("components/OwnerStripeCustomerLinks"));
check("it only calls the three owner functions from migration 261", ["owner_list_stripe_customer_links", "owner_link_stripe_customer", "owner_disable_stripe_customer_link"].every((name) => ui.includes(`"${name}"`) && migration.includes(`function public.${name}`)));
check("RPC argument names match the migration", migration.includes("owner_link_stripe_customer(target_client_id uuid, target_customer_id text)") && ui.includes("target_client_id: client.id, target_customer_id: value") && ui.includes("target_client_id: row.client_id, disable_note: null"));
check("only a cus_ customer ID is accepted client-side (a secret key is refused before it is sent)", ui.includes("/^cus_[A-Za-z0-9]{8,64}$/") && ui.indexOf("CUSTOMER_ID.test(value)") < ui.indexOf('rpc("owner_link_stripe_customer"'));
check("the page tells the owner never to paste a secret key", /Never paste a secret key/.test(ui));
check("QA-only and denied/archived/dormant clients are not offered", ui.includes("!client.qa_only") && ui.includes('["denied", "archived", "dormant"]'));
check("stored customer IDs are only ever shown masked (last 4 only)", (ui.match(/row\.provider_customer_id/g) || []).length === (ui.match(/maskCustomer\(row\.provider_customer_id\)/g) || []).length && (ui.match(/row\.provider_customer_id/g) || []).length >= 2);
check("linking and turning off both ask for confirmation first", (ui.match(/window\.confirm/g) || []).length === 2 && ui.indexOf("window.confirm(`Link") < ui.indexOf('rpc("owner_link_stripe_customer"') && ui.indexOf("window.confirm(`Turn off") < ui.indexOf('rpc("owner_disable_stripe_customer_link"'));
check("a failed action keeps its error visible (the reload does not clear messages)", !/async function loadLinks\(\) \{\s*setError\(""\)/.test(ui) && !ui.slice(ui.indexOf("const loadLinks"), ui.indexOf("useEffect")).includes('setError("")'));
check("errors are announced and nothing is rendered as HTML", ui.includes('role="alert"') && !ui.includes("dangerouslySetInnerHTML") && !ui.includes("innerHTML"));
check("the screen never touches keys, prices or billing state", !/STRIPE_SECRET|sk_live|sk_test|whsec_|owner_set_client_billing_state|monthly_price/.test(ui));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll owner Stripe link UI checks passed.");
process.exit(failures ? 1 : 0);
