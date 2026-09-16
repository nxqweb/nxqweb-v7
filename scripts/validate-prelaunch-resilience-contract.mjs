import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const websiteWorker = read("supabase/functions/build-business-website/index.ts");
const planWorker = read("supabase/functions/generate-business-build-plan/index.ts");

const checks = [
  [
    "Website retries skip unchanged GitHub files",
    websiteWorker.includes('existingContent === base64Content.replace(/\\s/g, "")')
      && websiteWorker.includes("unchanged: true"),
  ],
  [
    "Preview jobs preserve their provider wait start",
    websiteWorker.includes("preview_requested_at: previewRequestedAt")
      && websiteWorker.includes('step_key", "prepare_preview_request"'),
  ],
  [
    "Missing Netlify deploys become explicit provider blockers",
    websiteWorker.includes("Netlify has not created a preview deploy for the exact commit after 20 minutes")
      && websiteWorker.includes("EXTERNAL_PROVIDER_CAPACITY_BLOCKER"),
  ],
  [
    "Netlify credit exhaustion defers without destroying generated work",
    websiteWorker.includes("EXTERNAL_PROVIDER_BILLING_BLOCKER")
      && websiteWorker.includes('retry_after: "24 hours"')
      && websiteWorker.includes("providerBillingBlockReason(message)"),
  ],
  [
    "Generated fallback service-area copy preserves whitespace",
    planWorker.includes('const areaText = a ? ` across ${clip(a, 102)}`'),
  ],
  [
    "Generated copy clips at word boundaries",
    planWorker.includes('const boundary = candidate.lastIndexOf(" ")')
      && websiteWorker.includes('const boundary = candidate.lastIndexOf(" ")'),
  ],
  [
    "SEO descriptions use bounded complete-word copy",
    websiteWorker.includes("description: clipText(")
      && !websiteWorker.includes("get started.`.slice(0, 155)"),
  ],
];

let passed = 0;
for (const [label, ok] of checks) {
  if (ok) {
    console.log(`PASS  ${label}`);
    passed += 1;
  } else {
    console.error(`FAIL  ${label}`);
  }
}

console.log(`\n${passed}/${checks.length} prelaunch resilience checks passed.`);
if (passed !== checks.length) process.exit(1);
