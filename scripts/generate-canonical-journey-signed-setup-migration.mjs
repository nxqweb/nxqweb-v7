import fs from "node:fs";

const sourcePath = "supabase/migrations/190_client_launch_journey_read_model.sql";
const targetPath = "supabase/migrations/218_canonical_journey_signed_setup_evidence.sql";
let source = fs.readFileSync(sourcePath, "utf8");

const before = `  select exists(\n    select 1 from public.client_intakes i where i.client_id = client_row.id\n  ) into intake_exists;`;
const after = `  select (\n    exists(select 1 from public.client_intakes i where i.client_id = client_row.id)\n    or coalesce(client_row.notes, '') like '%NXQ WEB WEBSITE SETUP REPORT%'\n  ) into intake_exists;`;

if (!source.includes(before)) throw new Error("Legacy intake evidence block not found in migration 190");
source = source.replace(before, after);
source = source.replace(
  "-- Client-facing launch journey derived only from authoritative workflow evidence.\n-- This function is read-only: it does not advance automation or manufacture progress.",
  "-- Forward-only canonical journey hardening.\n-- Signed website setup reports are authoritative intake evidence for the current setup flow, while legacy client_intakes remain supported.\n-- This function stays read-only: it does not advance automation or manufacture progress.",
);
source += `\n\ncomment on function public.current_client_launch_journey() is\n  'Tenant-derived, read-only client launch timeline using both legacy intake rows and signed NXQ website setup reports as valid setup evidence, plus real approval, build, deployment, domain, billing, file-security, and maintenance evidence.';\n`;

if (!source.includes("NXQ WEB WEBSITE SETUP REPORT")) throw new Error("Signed setup evidence marker missing");
if (!source.includes("exists(select 1 from public.client_intakes")) throw new Error("Legacy intake compatibility missing");

fs.writeFileSync(targetPath, source);
console.log(`Generated ${targetPath} with dual legacy + signed setup evidence.`);
