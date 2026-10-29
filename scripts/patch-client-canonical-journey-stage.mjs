import fs from "node:fs";

const path = "src/pages/ClientPortal.tsx";
let source = fs.readFileSync(path, "utf8");

function replaceOnce(before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${label}: source shape not found`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`${label}: source shape matched more than once`);
  source = source.slice(0, first) + after + source.slice(first + before.length);
}

replaceOnce(
  'import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";',
  'import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";\nimport type { ClientLaunchJourney } from "../lib/clientJourney";',
  "journey type import",
);

replaceOnce(
  '  const [project, setProject] = useState<ProjectRow | null>(null);',
  '  const [project, setProject] = useState<ProjectRow | null>(null);\n  const [journey, setJourney] = useState<ClientLaunchJourney | null>(null);',
  "journey state",
);

replaceOnce(
  '  const projectStage = project?.website_status || client?.status || "loading";',
  '  const rawProjectStage = project?.website_status || client?.status || "loading";\n  const projectStage = journey?.stage_key || rawProjectStage;\n  const projectStageLabel = journey?.stage_title || formatStatus(rawProjectStage);',
  "canonical project stage",
);

source = source.replaceAll('        setProject(null);\n        setMessages([]);', '        setProject(null);\n        setJourney(null);\n        setMessages([]);');

const projectLoadBlock = `      if (projectResult.error) {
        setErrorMessage(\`Project stage load failed: \${projectResult.error.message}\`);
        setProject(null);
      } else {
        setProject((projectResult.data as ProjectRow) || null);
      }

      const messageResult`;

const journeyLoadBlock = `      if (projectResult.error) {
        setErrorMessage(\`Project stage load failed: \${projectResult.error.message}\`);
        setProject(null);
      } else {
        setProject((projectResult.data as ProjectRow) || null);
      }

      const journeyResult = await supabase.rpc("current_client_launch_journey");
      if (journeyResult.error) {
        setErrorMessage(\`Project journey load failed: \${journeyResult.error.message}\`);
        setJourney(null);
      } else {
        setJourney((journeyResult.data as ClientLaunchJourney) || null);
      }

      const messageResult`;
replaceOnce(projectLoadBlock, journeyLoadBlock, "journey RPC load");

replaceOnce(
  '            <strong>{formatStatus(projectStage)}</strong>',
  '            <strong>{projectStageLabel}</strong>',
  "header canonical stage label",
);

replaceOnce(
  '  const projectDecisionStatus = (projectStage || "").toLowerCase();',
  '  const projectDecisionStatus = (rawProjectStage || "").toLowerCase();',
  "raw project decision status",
);

const oldTracker = `            <div className="tracker">
              <span className={client?.status === "lead" ? "active" : ""}>Lead</span>
              <span className={client?.status === "intake_received" ? "active" : ""}>
                Setup submitted
              </span>
              <span className={client?.status === "needs_review" ? "active" : ""}>
                Owner Review
              </span>
              <span className={projectStage === "planning" ? "active" : ""}>Planning</span>
              <span className={projectStage === "building" ? "active" : ""}>Building</span>
              <span className={projectStage === "live" ? "active" : ""}>Live</span>
            </div>`;

const newTracker = `            <div className="tracker" data-canonical-journey-stage={projectStage}>
              <span className={projectStage === "setup" ? "active" : ""}>Setup</span>
              <span className={projectStage === "review" ? "active" : ""}>Owner Review</span>
              <span className={projectStage === "plan" ? "active" : ""}>Planning</span>
              <span className={projectStage === "build" ? "active" : ""}>Building</span>
              <span className={projectStage === "launch" || projectStage === "paused" ? "active" : ""}>Launch checks</span>
              <span className={projectStage === "care" ? "active" : ""}>Live</span>
            </div>`;
replaceOnce(oldTracker, newTracker, "canonical tracker");

if (!source.includes('supabase.rpc("current_client_launch_journey")')) throw new Error("canonical journey RPC missing");
if (!source.includes('projectStageLabel')) throw new Error("canonical header label missing");
if (!source.includes('data-canonical-journey-stage={projectStage}')) throw new Error("canonical tracker marker missing");
if (source.includes('projectStage === "planning"') || source.includes('projectStage === "building"') || source.includes('projectStage === "live"')) {
  throw new Error("legacy raw project-stage tracker checks remain");
}

fs.writeFileSync(path, source);
console.log("Client Portal header and tracker now use current_client_launch_journey as the canonical client-facing stage source.");
