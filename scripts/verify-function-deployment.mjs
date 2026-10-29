// Read-only helper for the manual staging workflow's single-function deploy action.
// Compares two `supabase functions list` JSON captures (before and after a deploy) and
// confirms that ONLY the named function changed. Prints function names, versions and
// statuses only; never secrets or project identifiers.
//
// Usage: node scripts/verify-function-deployment.mjs <before.json> <after.json> <slug> [--expect-verify-jwt=false|true]
//
// The list JSON may be a bare array or an envelope; entries are located by their string `slug`
// (or `name`) field. The Management API omits `verify_jwt` when it is false, so an absent value
// counts as false.
import fs from "node:fs";
import { pathToFileURL } from "node:url";

export function collectFunctions(parsed) {
  const found = new Map();
  const visit = (node, depth) => {
    if (!node || typeof node !== "object" || depth > 4) return;
    if (Array.isArray(node)) { for (const item of node) visit(item, depth + 1); return; }
    const slug = typeof node.slug === "string" ? node.slug : typeof node.name === "string" && ("version" in node || "status" in node) ? node.name : null;
    if (slug) { found.set(slug, node); return; }
    for (const value of Object.values(node)) visit(value, depth + 1);
  };
  visit(parsed, 0);
  return found;
}

const marker = (entry) => (entry && typeof entry.version === "number" ? `v${entry.version}` : entry && entry.updated_at != null ? `t${entry.updated_at}` : null);

export function compareDeployments(before, after, slug, expectVerifyJwt) {
  const problems = []; const notes = [];
  const was = collectFunctions(before); const now = collectFunctions(after);
  if (!now.size) return { ok: false, problems: ["The after-deploy function list was empty or in an unrecognized shape."], notes };
  const target = now.get(slug);
  if (!target) return { ok: false, problems: [`${slug} is not present after the deploy.`], notes };
  if (typeof target.status === "string" && target.status.toUpperCase() !== "ACTIVE") problems.push(`${slug} status is ${target.status}, expected ACTIVE.`);
  const verifyJwt = target.verify_jwt === true;
  if (verifyJwt !== expectVerifyJwt) problems.push(`${slug} verify_jwt is ${verifyJwt}, expected ${expectVerifyJwt}.`);

  const previous = was.get(slug);
  const beforeMark = marker(previous); const afterMark = marker(target);
  if (previous && !beforeMark) problems.push(`${slug}: the before-deploy list has no version or updated_at, so a change cannot be confirmed.`);
  else if (!afterMark) problems.push(`${slug}: the after-deploy list has no version or updated_at, so a change cannot be confirmed.`);
  else if (previous && afterMark === beforeMark) problems.push(`${slug} did not change (still ${afterMark}). The deploy may not have taken effect.`);
  else if (previous && typeof previous.version === "number" && typeof target.version === "number" && target.version < previous.version) problems.push(`${slug} version went backwards (${previous.version} -> ${target.version}).`);
  else notes.push(`${slug}: ${previous ? beforeMark : "(not deployed before)"} -> ${afterMark}, status ${target.status ?? "unreported"}, verify_jwt ${verifyJwt}.`);

  let unchanged = 0;
  for (const [other, entry] of now) {
    if (other === slug) continue;
    const prior = was.get(other);
    if (!prior) { problems.push(`${other} appeared during the deploy (it was not in the before list).`); continue; }
    if (marker(prior) !== marker(entry)) problems.push(`${other} changed during the deploy (${marker(prior)} -> ${marker(entry)}).`);
    else unchanged += 1;
  }
  for (const other of was.keys()) if (!now.has(other)) problems.push(`${other} disappeared during the deploy.`);
  notes.push(`${unchanged} other function(s) unchanged.`);
  return { ok: problems.length === 0, problems, notes };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [beforeFile, afterFile, slug, ...flags] = process.argv.slice(2);
  if (!beforeFile || !afterFile || !slug) { console.error("Usage: verify-function-deployment.mjs <before.json> <after.json> <slug> [--expect-verify-jwt=false|true]"); process.exit(2); }
  const expectArg = flags.find((flag) => flag.startsWith("--expect-verify-jwt="));
  const expectVerifyJwt = expectArg ? expectArg.split("=")[1] === "true" : false;
  let before; let after;
  try { before = JSON.parse(fs.readFileSync(beforeFile, "utf8")); after = JSON.parse(fs.readFileSync(afterFile, "utf8")); }
  catch { console.error("A function list capture was not valid JSON."); process.exit(1); }
  const result = compareDeployments(before, after, slug, expectVerifyJwt);
  for (const note of result.notes) console.log(note);
  if (!result.ok) { for (const problem of result.problems) console.error(`FAIL ${problem}`); process.exit(1); }
  console.log(`PASS only ${slug} changed.`);
}
