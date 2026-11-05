// Characterization test: the shared formatters in src/lib/format.ts must behave exactly like the
// page-local copies they replaced. The originals are kept here verbatim as reference implementations.
import fs from "node:fs";
import { formatDateTimeShort, formatMoneyIn, formatStatus, formatUsd, formatUsdWhole } from "../src/lib/format.ts";

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`PASS  ${name}`);
  else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); }
}

// ---- original local implementations (verbatim from the pre-refactor pages) ----
const originalStatusA = (value) => value.replaceAll("_", " ");
const originalStatusB = (status) => status.replaceAll("_", " ");
const originalDateTimeMulti = (value) => new Date(value).toLocaleString([], { dateStyle: "short", timeStyle: "short", });
const originalDateTimeOne = (value) => new Date(value).toLocaleString([], { dateStyle: "short", timeStyle: "short" });
const originalUsd = (value) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", }).format(value || 0);
const originalUsdWhole = (value) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0, }).format(value);
const originalMoneyIn = (value, currency = "USD") => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(value || 0));
const originalMoneyInAmount = (amount, currency = "USD") => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(amount || 0));

const statuses = ["", "pending_owner_approval", "a_b_c_d", "no underscores", "__edge__", "approved_for_preview"];
check("formatStatus matches both original variants on all samples", statuses.every((s) => formatStatus(s) === originalStatusA(s) && formatStatus(s) === originalStatusB(s)));

const dates = ["2026-10-05T12:34:56Z", "2026-01-01T00:00:00.000Z", "2025-12-31T23:59:59-08:00", "2026-06-15"];
check("formatDateTimeShort matches both original variants", dates.every((d) => formatDateTimeShort(d) === originalDateTimeMulti(d) && formatDateTimeShort(d) === originalDateTimeOne(d)));
check("an invalid date behaves like the original (same output or same error)", (() => {
  const run = (f) => { try { return f("not a date"); } catch (e) { return `throws:${e.name}`; } };
  return run(formatDateTimeShort) === run(originalDateTimeOne);
})());

const amounts = [0, 1, 12.5, 99.999, 1234567.891, -3.2, NaN, undefined, null];
check("formatUsd matches the original (including the || 0 fallback)", amounts.every((v) => formatUsd(v) === originalUsd(v)));
check("formatUsdWhole matches the original", [0, 1, 12.5, 150, 1234567.891, -3.2].every((v) => formatUsdWhole(v) === originalUsdWhole(v)));
check("formatMoneyIn matches both originals for several currencies", ["USD", "EUR", "GBP"].every((c) => amounts.every((v) => formatMoneyIn(v, c) === originalMoneyIn(v, c) && formatMoneyIn(v, c) === originalMoneyInAmount(v, c))));
check("formatMoneyIn defaults to USD like the originals", formatMoneyIn(5) === originalMoneyIn(5));

// ---- the pages must use the shared module and no longer define the replaced copies ----
const migrated = {
  formatStatus: ["ClientBillingStatus", "OwnerBillingLifecycle", "OwnerDeployments", "OwnerPlanChanges", "OwnerPortal", "OwnerPreviewRequests", "OwnerProductionLaunches"].map((n) => `src/pages/${n}.tsx`).concat(["src/components/ClientPlanManagement.tsx", "src/components/ClientWebsiteSecurity.tsx"]),
  formatDateTime: ["OwnerDeployments", "OwnerFiles", "OwnerPortal", "OwnerPreviewRequests", "OwnerProductionLaunches", "OwnerProductionStatus"].map((n) => `src/pages/${n}.tsx`),
  formatMoney: ["ClientBillingStatus", "OwnerBillingLifecycle", "OwnerPortal", "ClientCommerceOrders", "PublicCommerceCheckout"].map((n) => `src/pages/${n}.tsx`),
};
for (const [name, files] of Object.entries(migrated)) {
  const stale = files.filter((f) => new RegExp(`function ${name}\\b`).test(fs.readFileSync(f, "utf8")) || !fs.readFileSync(f, "utf8").includes('from "../lib/format"'));
  check(`${name}: ${files.length} files import the shared helper and no longer define their own copy`, stale.length === 0, stale.join(", "));
}

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll formatter equivalence checks passed.");
process.exit(failures ? 1 : 0);
