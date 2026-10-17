// Runs every offline Commerce, store and onboarding test in one go and prints a clear summary. These tests are registered as npm scripts and in
// the release gate, and since 2026-10-16 GitHub CI (NXQ Safe CI, step "Commerce and store tests") runs this file on every push to safe/** branches.
// Run it before every push too: `npm run test:store`. Read-only: it edits nothing.
import { spawnSync } from "node:child_process";

const tests = [
  "test-shopper-account", "test-commerce-launch-guide", "test-commerce-rpc-reason", "test-commerce-setup-form", "test-client-setup-sheet",
  "test-storefront-theme", "test-store-polish", "test-order-attention", "test-commerce-nav", "test-commerce-polish", "test-email-orders", "test-portal-help", "test-menu-mode", "test-referral-link", "test-reviews", "test-qr-code", "test-booking", "test-booking-time", "test-membership", "test-referral-invoice-credit", "test-rewards-page", "test-info-pages", "test-owner-billing-safety", "test-store-profile", "test-client-wording", "test-link-integrity", "test-app-resilience", "test-a11y-basics", "test-store-catalog", "test-store-experience",
];

const failed = [];
for (const name of tests) {
  const result = spawnSync("node", [`scripts/${name}.mjs`], { encoding: "utf8", timeout: 120000 });
  const lines = (result.stdout || "").split("\n");
  const passes = lines.filter((l) => l.startsWith("PASS")).length;
  const fails = lines.filter((l) => l.startsWith("FAIL"));
  const ok = result.status === 0 && fails.length === 0 && passes > 0;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} (${passes} checks)`);
  if (!ok) { failed.push(name); fails.forEach((l) => console.log(`      ${l}`)); if (result.status !== 0 && fails.length === 0) console.log(`      exit ${result.status}: ${(result.stderr || "").split("\n")[0]}`); }
}
console.log(failed.length ? `\n${failed.length} of ${tests.length} store test file(s) FAILED. Do not push until these pass.` : `\nAll ${tests.length} store test files passed.`);
process.exit(failed.length ? 1 : 0);
