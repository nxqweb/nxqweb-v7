import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const growth = read("supabase/migrations/229_referrals_grants_and_cost_guards.sql");
const finder = read("supabase/migrations/230_guarded_ai_client_finder.sql");
const stripe = read("supabase/functions/ingest-stripe-webhook/index.ts");
const discovery = read("supabase/functions/discover-sales-prospects/index.ts");
const audit = read("supabase/functions/audit-prospect-website/index.ts");
const drafting = read("supabase/functions/draft-sales-outreach-ai/index.ts");
const config = read("supabase/config.toml");

const checks = [
  ["Referral launch defaults to disabled", growth.includes("referral_program_enabled boolean not null default false") && growth.includes("founding_grant_public_enrollment_enabled boolean not null default false")],
  ["Referral credits preserve the $10 invoice floor", growth.includes("target_invoice_subtotal-floor_amount") && growth.includes("minimum_invoice_payment")],
  ["Referrer credit waits for payment and a risk hold", growth.includes("status='holding'") && growth.includes("hold_until<=now()") && growth.includes("risk_score<50")],
  ["Refunds and disputes reverse or block rewards", stripe.includes("payment_refunded") && stripe.includes("payment_disputed") && growth.includes("nxq_flag_referral_payment_reversal")],
  ["Founding Grant is legal-gated and capped at ten", growth.includes("founding_grant_legal_review_complete") && growth.includes("founding_grant_award_limit") && growth.includes("award_count>=settings.founding_grant_award_limit")],
  ["Resource use has server-side hard stops", growth.includes("nxq_reserve_client_resource") && growth.includes("monthly_limit_reached") && growth.includes("hard_stop")],
  ["Provider cost preserves the $40 operating contribution", growth.includes("minimum_monthly_contribution_before_referral_credits',40") && growth.includes("monthly_price,0)-40")],
  ["Client Finder starts stopped and review-only", finder.includes("automation_mode text not null default 'review_only'") && finder.includes("emergency_stop boolean not null default true") && finder.includes("external_delivery_enabled boolean not null default false")],
  ["Fictional prospect mode is permanently suppressed", finder.includes("'zero_key_fictional','fictional'") && finder.includes("@example.invalid") && finder.includes("'legal_hold',true")],
  ["Every send rechecks suppression, approval, hours, and daily cap", finder.includes("'outside_business_hours'") && finder.includes("'daily_limit_reached'") && finder.includes("'draft_not_approved'") && finder.includes("'recipient_suppressed'")],
  ["Complaints and hard bounces activate suppression", finder.includes("target_event_type in ('hard_bounce','complaint')") && finder.includes("emergency_stop=true")],
  ["Follow-ups remain owner-review drafts", finder.includes("nxq_create_due_sales_followup_drafts") && finder.includes("'owner_approval_required',true") && finder.includes("'automatic_send',false")],
  ["Discovery requires approved niches and protected provider credentials", discovery.includes("allowedNiches") && discovery.includes("NXQ_PROSPECT_DISCOVERY_PROVIDER_TOKEN")],
  ["Website audits use outbound URL protections", audit.includes("requirePublicHttpsUrl") && audit.includes("validatedRedirectTarget") && audit.includes("1_500_000")],
  ["AI drafting has a truthful zero-key fallback", drafting.includes("Use only supplied facts") && drafting.includes("zero_key_fallback") && drafting.includes("premium done-for-you website service")],
  ["All Client Finder functions are JWT protected", ["discover-sales-prospects", "audit-prospect-website", "draft-sales-outreach-ai"].every((name) => config.includes(`[functions.${name}]\nverify_jwt = true`))],
];

let failures = 0;
for (const [label, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  if (!ok) failures += 1;
}
if (failures) {
  console.error(`Growth and outreach contract failed: ${failures}/${checks.length}`);
  process.exit(1);
}
console.log(`Growth and outreach contract passed: ${checks.length}/${checks.length}`);
