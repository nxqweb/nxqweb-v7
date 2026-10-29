// Shared helper for pulling one named step's YAML block out of a GitHub Actions
// workflow file's text, used by multiple contract scripts that need to assert
// things about specific steps in .github/workflows/manual-supabase-stage.yml.
// Extracted here so those scripts can't independently drift out of sync again.

export function workflowStep(workflowText, name) {
  const marker = `      - name: ${name}`;
  const start = workflowText.indexOf(marker);
  if (start < 0) return "";
  const end = workflowText.indexOf("\n      - name:", start + marker.length);
  return workflowText.slice(start, end < 0 ? workflowText.length : end);
}
