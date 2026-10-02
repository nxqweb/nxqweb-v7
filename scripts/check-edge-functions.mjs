import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const functionRoot = path.join(process.cwd(), "supabase", "functions");
const denoBin = path.join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "deno.cmd" : "deno");
if (!fs.existsSync(denoBin)) {
  console.error("Deno is not installed. Run npm ci before the Edge-function check.");
  process.exit(1);
}

const files = fs.readdirSync(functionRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(functionRoot, entry.name, "index.ts")))
  .map((entry) => path.join("supabase", "functions", entry.name, "index.ts"))
  .sort();

for (const file of files) {
  const result = spawnSync(denoBin, ["check", "--no-config", "--node-modules-dir=manual", file], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (result.status !== 0) {
    console.error(`FAIL  ${file}`);
    console.error(result.stdout || result.stderr || "Unknown Deno check failure.");
    process.exit(result.status || 1);
  }
  console.log(`PASS  ${file}`);
}

console.log(`\n${files.length} Edge functions passed Deno type checking.`);
