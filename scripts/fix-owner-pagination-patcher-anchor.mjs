import fs from "node:fs";

const path = "scripts/patch-owner-portal-pagination.mjs";
let source = fs.readFileSync(path, "utf8");

const helperNeedle = `function replaceOne(pattern, replacement, label) {\n  const matches = [...source.matchAll(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : \`\${pattern.flags}g\`))];\n  if (matches.length !== 1) throw new Error(\`\${label}: expected 1 match, found \${matches.length}\`);\n  source = source.replace(pattern, replacement);\n}\n`;

const helperReplacement = `${helperNeedle}\nfunction replaceOneAfter(anchor, pattern, replacement, label) {\n  const anchorIndex = source.indexOf(anchor);\n  if (anchorIndex < 0) throw new Error(\`\${label}: anchor not found\`);\n  const tail = source.slice(anchorIndex);\n  const matches = [...tail.matchAll(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : \`\${pattern.flags}g\`))];\n  if (matches.length !== 1) throw new Error(\`\${label}: expected 1 anchored match, found \${matches.length}\`);\n  const patchedTail = tail.replace(pattern, replacement);\n  source = source.slice(0, anchorIndex) + patchedTail;\n}\n`;

if (!source.includes(helperNeedle)) throw new Error("replaceOne helper shape changed");
source = source.replace(helperNeedle, helperReplacement);

const callNeedle = `replaceOne(\n  /              \\{clients\\.map\\(\\(client\\) => \\(\/,\n  \`              {clientHasMore && clients.length > 0 ? (\\n                <button className="wide-btn" type="button" onClick={() => void loadMoreClients()} disabled={isLoadingMore}>\\n                  {isLoadingMore ? "Loading…" : "Load more clients"}\\n                </button>\\n              ) : null}\\n\\n              {clients.map((client) => (\`,\n  "load more client UI",\n);`;

const callReplacement = `replaceOneAfter(\n  '<div className="client-list">',\n  /              \\{clients\\.map\\(\\(client\\) => \\(\/,\n  \`              {clientHasMore && clients.length > 0 ? (\\n                <button className="wide-btn" type="button" onClick={() => void loadMoreClients()} disabled={isLoadingMore}>\\n                  {isLoadingMore ? "Loading…" : "Load more clients"}\\n                </button>\\n              ) : null}\\n\\n              {clients.map((client) => (\`,\n  "load more client UI",\n);`;

if (!source.includes(callNeedle)) throw new Error("load-more client patch shape changed");
source = source.replace(callNeedle, callReplacement);
fs.writeFileSync(path, source);
console.log("Anchored client-list pagination patcher.");
