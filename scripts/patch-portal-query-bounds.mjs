import fs from "node:fs";

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Missing expected source shape: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`Expected one source match for: ${label}`);
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function replaceAfterAnchor(source, anchor, before, after, label) {
  const anchorIndex = source.indexOf(anchor);
  if (anchorIndex < 0) throw new Error(`Missing expected anchor: ${label}`);
  const first = source.indexOf(before, anchorIndex);
  if (first < 0) throw new Error(`Missing expected source shape after anchor: ${label}`);
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function patch(path, transforms) {
  let source = fs.readFileSync(path, "utf8");
  for (const [before, after, label] of transforms) source = replaceOnce(source, before, after, label);
  fs.writeFileSync(path, source);
}

let owner = fs.readFileSync("src/pages/OwnerPortal.tsx", "utf8");
for (const [before, after, label] of [
  [
    '.order("created_at", { ascending: false });\n\n      if (approvalResult.error)',
    '.order("created_at", { ascending: false })\n        .limit(100);\n\n      if (approvalResult.error)',
    "owner approvals bound",
  ],
  [
    '.order("created_at", { ascending: false });\n\n      if (clientResult.error)',
    '.order("created_at", { ascending: false })\n        .limit(100);\n\n      if (clientResult.error)',
    "owner clients bound",
  ],
  [
    '.select("id, client_id, website_status, build_plan")\n        .order("created_at", { ascending: false });',
    '.select("id, client_id, website_status, build_plan")\n        .order("created_at", { ascending: false })\n        .limit(100);',
    "owner projects bound",
  ],
]) owner = replaceOnce(owner, before, after, label);
owner = replaceAfterAnchor(
  owner,
  "const messageResult = await supabase",
  '.order("created_at", { ascending: false });',
  '.order("created_at", { ascending: false })\n  .limit(250);',
  "owner messages bound",
);
fs.writeFileSync("src/pages/OwnerPortal.tsx", owner);

patch("src/pages/ClientPortal.tsx", [
  [
    '.eq("client_id", loadedClient.id)\n        .order("created_at", { ascending: false });',
    '.eq("client_id", loadedClient.id)\n        .order("created_at", { ascending: false })\n        .limit(100);',
    "client messages bound",
  ],
  [
    '.eq("client_id", loadedClient.id)\n        .order("requested_at", { ascending: false });',
    '.eq("client_id", loadedClient.id)\n        .order("requested_at", { ascending: false })\n        .limit(25);',
    "client domains bound",
  ],
]);

console.log("Applied bounded launch-safe portal queries; cursor read models remain available for later scale expansion.");
