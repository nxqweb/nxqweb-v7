// Read-only: confirms the linked Supabase project from `supabase projects list`
// JSON. Prints only the matching project's name and region; never the ref or
// any credential. Fails when no project, or more than one, matches the ref.
//
// Accepted shapes (Supabase CLI v2.107.0 source, `projects list`):
//   - `--output json`        -> a bare array of project objects (+ `linked`)
//   - `--output-format json` -> an envelope containing a `projects` array
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function extractProjects(parsed) {
  if (Array.isArray(parsed)) return parsed;
  const queue = [parsed];
  for (let depth = 0; depth < 3 && queue.length > 0; depth += 1) {
    const next = [];
    for (const node of queue) {
      if (!node || typeof node !== "object") continue;
      if (Array.isArray(node.projects)) return node.projects;
      next.push(...Object.values(node));
    }
    queue.length = 0;
    queue.push(...next);
  }
  return null;
}

export function confirmProject(parsed, ref) {
  if (!ref) return { ok: false, message: "SUPABASE_PROJECT_REF is not set." };
  const projects = extractProjects(parsed);
  if (!projects) {
    const keys = parsed && typeof parsed === "object" ? Object.keys(parsed).join(", ") : typeof parsed;
    return { ok: false, message: `Unrecognized projects list JSON shape (top-level: ${keys || "none"}).` };
  }
  const matches = projects.filter((p) => p && typeof p === "object" && (p.id === ref || p.ref === ref));
  if (matches.length === 0) return { ok: false, message: "Linked project not found in the accessible projects list." };
  if (matches.length > 1) return { ok: false, message: `Ambiguous: ${matches.length} projects match the linked ref.` };
  const [match] = matches;
  return { ok: true, name: String(match.name ?? "(unknown)"), region: String(match.region || "(unknown)") };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(process.argv[2], "utf8"));
  } catch {
    console.error("Projects list output was not valid JSON.");
    process.exit(1);
  }
  const result = confirmProject(parsed, process.env.SUPABASE_PROJECT_REF);
  if (!result.ok) {
    console.error(result.message);
    process.exit(1);
  }
  console.log("Linked project name:", result.name);
  console.log("Linked project region:", result.region);
}
