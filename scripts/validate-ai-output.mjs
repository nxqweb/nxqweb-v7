// Checks an AI Desk answer before anything uses it.
//   node scripts/validate-ai-output.mjs build-plan <task-file> <answer-file>
// <task-file> is the text you copied with "Copy AI task" (the whole thing is fine) or just its JSON request.
// <answer-file> is whatever the AI Desk chat replied. Read-only: it prints PASS or a plain list of problems, and edits nothing.
import fs from "node:fs";
import { parseDeskReply, validateDeskRequest, validateDeskResult } from "./lib/ai-desk.mjs";

const [kind, taskPath, answerPath] = process.argv.slice(2);
if (kind !== "build-plan" || !taskPath || !answerPath) {
  console.log("Usage: node scripts/validate-ai-output.mjs build-plan <task-file> <answer-file>");
  process.exit(2);
}

function requestFrom(raw) {
  const marker = raw.indexOf("REQUEST_JSON_START");
  const end = raw.indexOf("REQUEST_JSON_END");
  const body = marker >= 0 && end > marker ? raw.slice(marker + "REQUEST_JSON_START".length, end) : raw;
  return parseDeskReply(body);
}

const task = requestFrom(fs.readFileSync(taskPath, "utf8"));
if (!task.ok) { console.log(`FAIL  task file: ${task.error}`); process.exit(1); }
const requestErrors = validateDeskRequest(task.value);
if (requestErrors.length) { console.log("FAIL  the task itself is not valid:"); requestErrors.forEach((e) => console.log(`  - ${e}`)); process.exit(1); }

const answer = parseDeskReply(fs.readFileSync(answerPath, "utf8"));
if (!answer.ok) { console.log(`FAIL  ${answer.error}`); process.exit(1); }
const problems = validateDeskResult(answer.value, task.value);
if (problems.length) {
  console.log(`FAIL  ${problems.length} problem(s) with the answer:`);
  problems.forEach((p) => console.log(`  - ${p}`));
  process.exit(1);
}
(answer.notes || []).forEach((n) => console.log(`NOTE  ${n}`));
console.log("PASS  the answer would pass the live pipeline's checks (shape, limits, approved services/pages/theme, no unsupported claims).");
