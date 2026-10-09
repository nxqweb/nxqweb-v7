import fs from "node:fs";
const read=(file)=>fs.readFileSync(file,"utf8");
const migration=read("supabase/migrations/191_client_value_and_history_read_model.sql");
const page=read("src/pages/ClientValueHistory.tsx");
const app=read("src/App.tsx");
const journey=read("src/pages/ClientLaunchJourney.tsx");

const checks=[
  ["Value history is stable and read-only",migration.includes("returns jsonb language plpgsql stable security definer")&&!/\b(?:insert|update|delete)\s+(?:into|public\.)/i.test(migration)],
  ["Tenant identity comes from authenticated client",migration.includes("where auth_user_id=auth.uid()")&&migration.includes("Client account not found")],
  ["History uses recorded deployment evidence",migration.includes("public.project_deployments")&&migration.includes("status='published'")],
  ["History uses completed maintenance evidence",migration.includes("public.website_maintenance_tasks")&&migration.includes("status='completed'")],
  ["History uses published change evidence",migration.includes("public.website_change_requests")&&migration.includes("Website update published")],
  ["History uses delivered monthly report evidence",migration.includes("public.client_monthly_business_reports")&&migration.includes("Monthly value report")],
  ["Payment records exclude external provider identifiers",migration.includes("public.payment_records")&&!migration.includes("external_payment_id")],
  ["Owner-only payment notes are not returned",!migration.includes("p.note")],
  ["History is bounded",migration.includes("limit 120")],
  ["Claims policy forbids invented value",migration.includes("recorded_evidence_only")&&migration.includes("without invented ROI")],
  ["Anonymous callers are excluded",migration.includes("revoke all on function public.current_client_value_history() from public,anon")],
  ["Page uses only the tenant-safe RPC",page.includes('supabase.rpc("current_client_value_history")')&&!page.includes('.from("payment_records")')],
  ["Page refuses to mislabel records as invoices or receipts",page.includes("does not call a record an invoice or receipt unless that document was actually issued")],
  ["Page exposes evidence counts and event details",page.includes("value-summary-grid")&&page.includes("Website history")&&page.includes("Payment records")],
  ["History route is wired and smoke tested",app.includes('path === "/client/history"')&&read("scripts/smoke-built-routes.mjs").includes('"/client/history"')],
  ["Website Journey links to value history",journey.includes('href="/client/history"')],
];
let passed=0;for(const [name,ok] of checks){console.log(`${ok?"PASS":"FAIL"}  ${name}`);if(ok)passed+=1;}console.log(`\n${passed}/${checks.length} autonomy ops wave-thirty-four checks passed.`);if(passed!==checks.length)process.exit(1);
