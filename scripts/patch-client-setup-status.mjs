import fs from "node:fs";

const path = "src/pages/ClientPortal.tsx";
let source = fs.readFileSync(path, "utf8");
const before = '  const setupComplete = client ? completedSetupStatuses.includes(client.status) : false;\n  const projectStage = project?.website_status || client?.status || "loading";';
const after = '  const signedSetupSubmitted = client ? parseClientSetupReport(client.notes).size > 0 : false;\n  const setupComplete = client\n    ? completedSetupStatuses.includes(client.status) || signedSetupSubmitted\n    : false;\n  const projectStage = project?.website_status || client?.status || "loading";';

const first = source.indexOf(before);
if (first < 0) throw new Error("Missing expected setupComplete source shape.");
if (source.indexOf(before, first + before.length) >= 0) throw new Error("setupComplete source shape is not unique.");
source = source.slice(0, first) + after + source.slice(first + before.length);
fs.writeFileSync(path, source);
console.log("Client Portal setup completion now honors the signed website setup report.");
