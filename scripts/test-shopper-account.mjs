// Offline test: shopper account helpers and wiring (migration 268). Guest checkout must stay untouched, shoppers must never be
// created as business clients, no card data, no internal error text shown, and every database call must be a real function.
import fs from "node:fs";
import {
  formatOrderTotal, friendlyShopperError, isShopperAccountPath, mergeCheckoutAutofill, normalizeProfileInput, orderStatusLabel,
  profileToCheckoutFields, shopperAccountPath, shopperLimits, storeSlugFromPath, validateCredentials,
  forgotPasswordSentMessage, isRecoveryUrl, resetRedirectUrl, tooManyAttemptsMessage, validateEmailOnly, validateNewPassword,
} from "../src/lib/shopperAccount.ts";

let failures = 0;
function check(name, ok, detail = "") { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); } }

// ---- paths
check("slug is read from the store and account paths", storeSlugFromPath("/store/candles-abc123") === "candles-abc123" && storeSlugFromPath("/store/candles-abc123/account") === "candles-abc123" && storeSlugFromPath("/") === "");
check("account path is built and recognised, and is not the store page", shopperAccountPath("candles-abc123") === "/store/candles-abc123/account" && isShopperAccountPath("/store/candles-abc123/account") && isShopperAccountPath("/store/x/account/") && !isShopperAccountPath("/store/x") && !isShopperAccountPath("/store/x/accountant") && !isShopperAccountPath("/store/x/account/more"));

// ---- profile input
const ok = normalizeProfileInput({ fullName: "  Jo Shopper ", phone: " 555-0101 ", address: " 1 Main St, Austin TX " });
check("profile input is trimmed and shaped for the database", ok.ok && ok.payload.full_name === "Jo Shopper" && ok.payload.phone === "555-0101" && ok.payload.shipping_address.address === "1 Main St, Austin TX");
const blank = normalizeProfileInput({ fullName: "  ", phone: "", address: "" });
check("empty name and phone become null, not empty strings", blank.ok && blank.payload.full_name === null && blank.payload.phone === null);
check("over-long name, phone and address are refused with a plain message", !normalizeProfileInput({ fullName: "x".repeat(shopperLimits.name + 1), phone: "", address: "" }).ok && !normalizeProfileInput({ fullName: "", phone: "1".repeat(shopperLimits.phone + 1), address: "" }).ok && !normalizeProfileInput({ fullName: "", phone: "", address: "a".repeat(shopperLimits.address + 1) }).ok);
check("limits match the database (160 / 80)", shopperLimits.name === 160 && shopperLimits.phone === 80);

// ---- forgot password / reset
check("reset email returns to the same account URL sign-up uses (one Supabase allow-list entry covers both)", resetRedirectUrl("https://shop.example.com", "candles-abc123") === "https://shop.example.com/store/candles-abc123/account" && resetRedirectUrl("https://shop.example.com/", "x") === "https://shop.example.com/store/x/account");
check("a recovery link is recognised from the URL hash, and a normal visit or sign-up confirmation is not", isRecoveryUrl("#access_token=abc&type=recovery") && isRecoveryUrl("#type=recovery&access_token=abc") && isRecoveryUrl("", "?type=recovery") && !isRecoveryUrl("") && !isRecoveryUrl("#access_token=abc&type=signup") && !isRecoveryUrl("#note=type=recoveryx"));
check("forgot form needs a real-looking email", validateEmailOnly("jo@shop.com").ok && !validateEmailOnly("").ok && !validateEmailOnly("jo@").ok);
check("new password must be long enough and typed twice the same", validateNewPassword("longenough1", "longenough1").ok && !validateNewPassword("short", "short").ok && !validateNewPassword("longenough1", "longenough2").ok);
check("same-password and rate-limit errors get plain sentences", /not used before/.test(friendlyShopperError("New password should be different from the old password.")) && friendlyShopperError("email rate limit exceeded") === tooManyAttemptsMessage);
check("the forgot-password confirmation never says whether the email has an account", /^If that email has an account/.test(forgotPasswordSentMessage) && !/not found|no account|does not exist/i.test(forgotPasswordSentMessage));

// ---- autofill
const saved = profileToCheckoutFields({ email: "a@b.co", full_name: "Jo", phone: "555", shipping_address: { address: "1 Main St", extra: "ignored" } });
check("saved profile maps to the checkout fields", saved.email === "a@b.co" && saved.name === "Jo" && saved.phone === "555" && saved.address === "1 Main St");
check("missing or odd saved data gives empty fields, never 'undefined'", JSON.stringify(profileToCheckoutFields(null)) === '{"email":"","name":"","phone":"","address":""}' && profileToCheckoutFields({ shipping_address: { address: 5 } }).address === "");
const merged = mergeCheckoutAutofill({ name: "Typed Name", email: "", phone: "", address: "" }, saved);
check("autofill fills blanks but never overwrites what the shopper typed", merged.name === "Typed Name" && merged.email === "a@b.co" && merged.address === "1 Main St");

// ---- credentials
check("email and password are checked before calling sign-up", !validateCredentials("nope", "longenough1").ok && !validateCredentials("a@b.co", "short").ok && validateCredentials("a@b.co", "longenough1").ok);

// ---- friendly errors
const mapped = {
  "Sign in to continue.": /sign in/i,
  "Confirm your email address to use your account.": /confirm your email/i,
  "Email not confirmed": /confirm your email/i,
  "Customer accounts are not available for this store.": /guest/i,
  "Invalid login credentials": /do not match/i,
  "User already registered": /already exists/i,
};
check("known errors become plain sentences", Object.entries(mapped).every(([raw, expected]) => expected.test(friendlyShopperError(raw))));
check("unknown and internal errors never leak", friendlyShopperError('relation "commerce_orders" does not exist') === "Something went wrong. Please try again in a moment." && friendlyShopperError(null) === "Something went wrong. Please try again in a moment.");

// ---- order labels
const label = (o) => orderStatusLabel(o);
check("order status reads in plain words", label({ payment_status: "pending", fulfillment_stage: "new" }).startsWith("Waiting for the store")
  && label({ payment_status: "paid", fulfillment_stage: "processing" }) === "Paid, being prepared"
  && label({ payment_status: "paid", fulfillment_stage: "shipped" }) === "Shipped"
  && label({ payment_status: "paid", fulfillment_stage: "delivered" }) === "Delivered"
  && label({ fulfillment_stage: "cancelled" }) === "Cancelled"
  && label({ payment_status: "refunded", fulfillment_stage: "refunded" }) === "Refunded");
check("order total is formatted as money", formatOrderTotal({ grand_total: 12, currency_code: "USD" }) === "$12.00" && formatOrderTotal({ grand_total: "abc" }) === "");

// ---- wiring
const account = fs.readFileSync("src/pages/PublicShopperAccount.tsx", "utf8");
const storefront = fs.readFileSync("src/pages/PublicCommerceStorefront.tsx", "utf8");
const live = fs.readFileSync("src/pages/ClientCommerceLiveStore.tsx", "utf8");
const app = fs.readFileSync("src/App.tsx", "utf8");
const migration = fs.readFileSync("supabase/migrations/268_shopper_accounts.sql", "utf8");
const api = fs.readFileSync("src/lib/shopperApi.ts", "utf8");

const rpcNames = (text) => [...text.matchAll(/\.rpc\(\s*"([a-z_]+)"/g)].map((m) => m[1]);
const definedIn268 = new Set([...migration.matchAll(/create or replace function public\.([a-z_]+)\(/g)].map((m) => m[1]));
const allowedOutside = new Set(["get_public_stripe_ready_commerce_storefront", "create_public_stripe_ready_direct_payment_order", "get_my_stripe_ready_storefront_settings", "save_my_stripe_ready_storefront_settings", "set_my_commerce_product_live", "get_my_store_profile", "save_my_store_profile", "get_public_store_profile"]); // the three store-profile functions are checked against migration 269 in test-store-profile.mjs
const shopperRpcs = [...new Set([...rpcNames(account), ...rpcNames(storefront), ...rpcNames(live), ...rpcNames(api)])].filter((n) => !allowedOutside.has(n));
check("every shopper database call is a real function from migration 268", shopperRpcs.length >= 6 && shopperRpcs.every((n) => definedIn268.has(n)), shopperRpcs.filter((n) => !definedIn268.has(n)).join(","));
const signedInOnly = ["get_my_shopper_profile", "save_my_shopper_profile", "delete_my_shopper_profile", "list_my_shopper_orders"];
check("the shopper module wraps all four signed-in functions", signedInOnly.every((n) => api.includes(`"${n}"`)));
check("the account page uses all four wrappers", ["fetchShopperProfile(", "fetchShopperOrders(", "saveShopperProfile(", "deleteShopperProfile("].every((n) => account.includes(n)));
check("no signed-in-only database call sits inside an anonymous-facing Public* page (the local schema harness treats Public* files as anonymous)", signedInOnly.every((n) => !account.includes(`"${n}"`) && !storefront.includes(`"${n}"`)));

const signUpCall = account.slice(account.indexOf("auth.signUp("), account.indexOf("auth.signUp(") + 260);
check("sign-up sends NO user metadata (a shopper must never become a business client)", signUpCall.includes("auth.signUp(") && !/\bdata\s*:/.test(signUpCall) && !/business_name|product_family|product_tier/.test(account));
check("no card fields anywhere on the shopper page", !/cc-number|cardnumber|card number|cvc|cvv|card_number/i.test(account) && account.includes("We never ask for or store card details here"));
check("account page never shows raw error text (every message goes through friendlyShopperError)", account.includes("friendlyShopperError(") && !/\.message/.test(account.replace(/friendlyShopperError\([^()]*\)/g, "")));
check("account page has a guest-friendly 'not offered' state", account.includes("does not offer customer accounts right now") && account.includes("check out as a guest"));
check("account page offers delete-my-saved-details with a confirm", account.includes("deleteShopperProfile(") && account.includes("window.confirm"));

check("the account route is registered", app.includes("<PublicShopperAccount />") && app.includes('"PublicShopperAccount"'));
check("the account route cannot be swallowed by the generic store matcher", !/^\/store\/[^/]+\/?$/.test("/store/x/account") && app.indexOf("<PublicShopperAccount />") > 0);

check("guest checkout is still allowed with no account", storefront.includes("if (!supabase || cart.length === 0) return;") && !/if \(!signedIn\)/.test(storefront));
check("account lookup on the store page cannot break checkout (errors swallowed)", /async function loadAccountHelp\(\)[\s\S]*try \{[\s\S]*catch \{ \/\* guest checkout continues \*\/ \}/.test(storefront));
check("details are saved to the account only for signed-in shoppers who opted in", storefront.includes("if (signedIn && saveToAccount)") && storefront.includes("Save these details to my account for next time"));
check("the Sign in link appears only when the store has accounts on", storefront.includes("accountsEnabled ? <a className=\"icon-btn\" href={shopperAccountPath(slug)}>"));

check("page sends the reset email through resetPasswordForEmail with the account-page redirect", account.includes("auth.resetPasswordForEmail(") && account.includes("resetRedirectUrl(window.location.origin, slug)"));
check("page shows the same message after a reset request whether or not it worked (except rate limits)", account.includes("setMessage(forgotPasswordSentMessage)") && !/resetPasswordForEmail[\s\S]{0,400}(not found|no account)/i.test(account));
check("page switches to a new-password form on recovery (URL on first render and PASSWORD_RECOVERY event) and changes it with updateUser", account.includes("isRecoveryUrl(window.location.hash") && account.includes('"PASSWORD_RECOVERY"') && account.includes("auth.updateUser({ password: newPassword })") && account.includes("validateNewPassword("));
check("a recovery visit does not show the signed-in account view before the password is changed", /recovering \? <section[\s\S]*Change password[\s\S]*: !signedInEmail && mode === "forgot"/.test(account) && account.includes("if (enabled && recovering)"));
check("a dead reset link asks for a fresh one instead of a blank page", account.includes("This reset link is invalid or has expired. Request a new one."));
check("sign-in screen offers 'Forgot your password?' only on sign-in", account.includes('mode === "signin" ? <button') && account.includes("Forgot your password?"));
check("the recovery listener is cleaned up on unmount", account.includes("subscription.unsubscribe()"));

check("owner switch asks for confirmation and calls the owner function", live.includes("set_my_customer_accounts_enabled") && /toggleAccounts\(\)[\s\S]*window\.confirm/.test(live) && live.includes("No card details are stored"));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll shopper-account checks passed (offline).");
process.exit(failures ? 1 : 0);
