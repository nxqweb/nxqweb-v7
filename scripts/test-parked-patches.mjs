// Offline test: parked screen patches (docs/drafts/patches). A patch holds finished screens that call database functions which exist
// only in a draft migration. Two things must stay true until the owner approves the draft:
//   1. no page in src/ calls one of those functions (the standing rule: source only calls functions a real migration defines), and
//   2. the patch still applies cleanly to the current pages, so it is ready on the day it is needed instead of found broken.
import fs from "node:fs";
import { spawnSync } from "node:child_process";

let failures = 0;
function check(name, ok, detail = "") { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); } }
const read = (file) => fs.readFileSync(file, "utf8");
const srcFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? srcFiles(`${dir}/${e.name}`) : /\.tsx?$/.test(e.name) ? [`${dir}/${e.name}`] : []);

// patch file -> the draft it waits for, and the word in a real migration's file name that means the draft was promoted
const parked = [
  { patch: "08_store_shipping_frontend.patch", draft: "08_store_shipping_fee.sql", promotedName: /store_shipping_fee/ },
  { patch: "10_store_media_frontend.patch", draft: "10_store_media.sql", promotedName: /store_media/ },
];

const onDisk = fs.readdirSync("docs/drafts/patches").filter((f) => f.endsWith(".patch")).sort();
check("every patch in the folder is listed here (so each one is guarded)", JSON.stringify(onDisk) === JSON.stringify(parked.map((p) => p.patch).sort()), onDisk.join(","));
const realMigrations = fs.readdirSync("supabase/migrations");
const realSql = realMigrations.filter((f) => f.endsWith(".sql")).map((f) => read(`supabase/migrations/${f}`)).join("\n");
const sources = srcFiles("src").map((f) => [f, read(f)]);

for (const { patch, draft, promotedName } of parked) {
  const promoted = realMigrations.some((f) => promotedName.test(f));
  if (promoted) { check(`${patch}: its draft is now a real migration (apply the patch, then delete it and this entry)`, true); continue; }
  const draftSql = read(`docs/drafts/migrations/${draft}`);
  const draftOnly = [...draftSql.matchAll(/create or replace function public\.(\w+)/g)].map((m) => m[1]).filter((name) => !new RegExp(`function\\s+public\\.${name}\\s*\\(`).test(realSql));
  check(`${patch}: its draft defines functions that no real migration has yet`, draftOnly.length > 0, draft);
  const callers = sources.filter(([, text]) => draftOnly.some((name) => text.includes(`"${name}"`))).map(([file]) => file);
  check(`${patch}: no page calls a draft-only function yet`, callers.length === 0, callers.join(","));
  const patchText = read(`docs/drafts/patches/${patch}`);
  check(`${patch}: the patch is what adds those calls`, draftOnly.some((name) => patchText.includes(`"${name}"`)));
  const applies = spawnSync("git", ["apply", "--check", `docs/drafts/patches/${patch}`], { encoding: "utf8" });
  check(`${patch}: still applies cleanly to the current pages`, applies.status === 0, (applies.stderr || "").split("\n")[0]);
}

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll parked patch checks passed (offline).");
process.exit(failures ? 1 : 0);
