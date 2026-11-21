import fs from "node:fs";
import path from "node:path";

const root = path.join(process.cwd(), "supabase", "migrations");
const files = fs.readdirSync(root).filter((name) => name.endsWith(".sql")).sort();
const seen = new Map();
let failed = false;

for (const file of files) {
  const match = /^(\d{3})_[a-z0-9_]+\.sql$/.exec(file);
  if (!match) {
    console.error(`FAIL  Invalid migration filename: ${file}`);
    failed = true;
    continue;
  }
  if (seen.has(match[1])) {
    console.error(`FAIL  Duplicate migration number ${match[1]}: ${seen.get(match[1])}, ${file}`);
    failed = true;
  }
  seen.set(match[1], file);
  const sql = fs.readFileSync(path.join(root, file), "utf8");
  const delimiters = (sql.match(/\$\$/g) || []).length;
  if (delimiters % 2 !== 0) {
    console.error(`FAIL  Unbalanced function delimiter in ${file}`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log(`PASS  ${files.length} uniquely numbered migrations have valid names and balanced function delimiters.`);
