import fs from "node:fs";
const read=(file)=>fs.readFileSync(file,"utf8");
const migration=read("supabase/migrations/192_owner_sales_outreach_foundation.sql");
const page=read("src/pages/OwnerSalesPipeline.tsx");
const app=read("src/App.tsx");
const worker=read("supabase/functions/build-business-website/index.ts");
const preset=read("supabase/functions/_shared/business-industry-presets.ts");
const demo=read("templates/business-v1/tree-service-demo.config.js");

const checks=[
  ["NXQ prospects are separate from client leads",migration.includes("create table if not exists public.nxq_sales_prospects")&&!migration.includes("references public.client_leads")],
  ["All sales tables are RLS protected",["nxq_sales_outreach_settings","nxq_sales_prospects","nxq_sales_contact_permissions","nxq_sales_outreach_drafts","nxq_sales_outreach_events"].every(name=>migration.includes(`alter table public.${name} enable row level security`))],
  ["Owner identity gates every sales mutation",(migration.match(/Authenticated owner access required\./g)||[]).length>=7],
  ["Cold SMS is blocked by permission evidence",migration.includes("SMS and Discord approval require documented consent evidence")&&migration.includes("evidence_at is null")],
  ["Cold Discord is blocked",migration.includes("cold_discord_dm_allowed',false")&&migration.includes("No cold DMs, bulk messages, self-bots, or user-bots")],
  ["Commercial email requires sender address and opt out",migration.includes("physical postal address are required")&&migration.includes("email_opt_out_instruction")],
  ["Every draft requires owner approval",migration.includes("owner_approval_required',true")&&migration.includes("status='approved'")],
  ["There is no autonomous provider send path",migration.includes("automatic_send',false")&&!migration.includes("notification_deliveries")&&!migration.includes("provider_message_id")],
  ["Opt out is an atomic all-channel hard stop",migration.includes("status='do_not_contact'")&&migration.includes("all_channels_revoked")&&migration.includes("status='cancelled'")],
  ["Prospect scoring is deterministic and bounded",migration.includes("create or replace function public.nxq_sales_score")&&migration.includes("least(100,greatest(0,score_value))")],
  ["No-website businesses are the primary qualification signal",migration.includes("target_signals->>'no_website'")&&migration.includes("score_value:=score_value+35")],
  ["Prospecting supports many industries",["tree_services","roofing","auto_services","home_services","professional_services","health_wellness","food_hospitality","retail","other"].every(key=>migration.includes(`'${key}'`))&&page.includes("Target any legitimate U.S. business without a website")],
  ["Owner pipeline uses protected RPC writes",page.includes('supabase.rpc(name, args)')&&!/\.from\([^)]*\)\.(?:insert|update|delete|upsert)/.test(page)],
  ["Sales route is protected and smoke tested",app.includes('path === "/owner/sales"')&&read("scripts/smoke-built-routes.mjs").includes('"/owner/sales"')],
  ["Tree Services preset is deterministic",preset.includes('key: "tree_services_v1"')&&preset.includes("getBusinessIndustryPreset")],
  ["Tree preset does not invent safety or response guarantees",preset.includes("without promising availability")&&preset.includes("no remote safety guarantee")],
  ["Business worker applies the industry preset",worker.includes("getBusinessIndustryPreset")&&worker.includes("industryPresetKey")&&worker.includes("getPresetServiceDescription")],
  ["Flagship demo is explicitly fictional and offline-safe",demo.includes("fictional: true")&&demo.includes("liveLeadCapture: false")&&demo.includes("liveAnalytics: false")],
];
let passed=0;for(const [name,ok] of checks){console.log(`${ok?"PASS":"FAIL"}  ${name}`);if(ok)passed+=1;}console.log(`\n${passed}/${checks.length} autonomy ops wave-thirty-five checks passed.`);if(passed!==checks.length)process.exit(1);
