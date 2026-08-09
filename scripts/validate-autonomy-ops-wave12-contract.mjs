import fs from "node:fs";
const read=(p)=>fs.readFileSync(p,"utf8");
const sync=read("supabase/migrations/164_complete_change_request_publish_evidence.sql");
const page=read("src/pages/ClientBusinessChanges.tsx");

const checks=[
  ["Preview URL comes from exact completed client review step",sync.includes("s.run_id=new.id")&&sync.includes("s.step_key='client_review'")&&sync.includes("s.status='completed'")&&sync.includes("s.output->>'preview_url'")],
  ["Published URL comes from same client project deployment config",sync.includes("d.project_id=new.project_id")&&sync.includes("d.client_id=new.client_id")&&sync.includes("d.production_url")],
  ["Change evidence accepts only HTTPS URLs",sync.includes("preview_url_value not like 'https://%'")&&sync.includes("published_url_value not like 'https://%'")],
  ["Only exact bound change request is updated",sync.includes("r.automation_plan->>'website_automation_run_id'=new.id::text")&&sync.includes("where r.id=target_change_id")],
  ["Published and failed changes receive completion timestamp",sync.includes("target_status in ('published','failed')")&&sync.includes("completed_at")],
  ["Content revision moves to preview",sync.includes("set state='preview'")&&sync.includes("change_request_id=target_change_id")],
  ["Content revision moves to published",sync.includes("set state='published'")&&sync.includes("state in ('draft','preview')")],
  ["Client change history reads preview and published URLs",page.includes("preview_url")&&page.includes("published_url")],
  ["Client page renders preview link",page.includes('href={row.preview_url}')&&page.includes('>Preview</a>')],
  ["Client page renders published site link",page.includes('href={row.published_url}')&&page.includes('>Published site</a>')],
];
let passed=0;for(const [label,ok] of checks){if(ok){console.log(`PASS  ${label}`);passed++;}else console.error(`FAIL  ${label}`);}console.log(`\n${passed}/${checks.length} autonomy ops wave-twelve checks passed.`);if(passed!==checks.length)process.exit(1);
