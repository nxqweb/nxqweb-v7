import fs from "node:fs";

const path = "src/pages/OwnerPortal.tsx";
let source = fs.readFileSync(path, "utf8");
source = source.replaceAll(
  'client?.business_name || message.business_name || "Unknown client"',
  'client?.business_name || "Unknown client"',
);
fs.writeFileSync(path, source);
console.log("Removed out-of-scope message fallback from Owner Portal pagination patch.");
