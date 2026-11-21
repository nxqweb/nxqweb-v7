// Offline guard: the SQL in docs/OWNER_STYLE_BACKFILL.md (which the owner will paste into the Supabase SQL editor) is word for word the SQL that the real-Postgres regression test ran,
// and the doc still warns about the one thing that matters: running it queues the clients' build plans.
import fs from "node:fs";

let failures = 0;
function check(name, ok) { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}`); } }
const norm = (text) => text.replace(/\s+/g, " ").trim();
const doc = fs.readFileSync("docs/OWNER_STYLE_BACKFILL.md", "utf8");
const test = norm(fs.readFileSync("scripts/sql/local-full-schema/regression/owner_style_backfill.test.sql", "utf8"));
const blocks = [...doc.matchAll(/```sql\n([\s\S]*?)```/g)].map((m) => norm(m[1]));

check("the doc has exactly two SQL blocks: a preview and an apply statement", blocks.length === 2 && /^select /.test(blocks[0]) && /^update public\.client_intakes/.test(blocks[1]));
check("the preview is read-only (no insert, update, delete or alter)", !/\b(insert|update|delete|alter|drop|truncate)\b/i.test(blocks[0]));
// The test wraps the preview in a subselect, so compare its core (from "select c.business_name" to "order by" is replaced in the test by a subquery without the order/intake_id column)
const previewWhere = blocks[0].slice(blocks[0].indexOf("from public.client_intakes ci"), blocks[0].indexOf(" order by"));
check("the preview's FROM/WHERE is the one the test ran", test.includes(previewWhere));
check("the apply statement is word for word the one the test ran", test.includes(blocks[1].replace(/;$/, "")));
check("the apply statement touches only an empty style, only the newest intake of each client, and only when a style was found", /distinct on \(i\.client_id\)/.test(blocks[1]) && /order by i\.client_id, i\.created_at desc/.test(blocks[1]) && /nullif\(btrim\(coalesce\(ci\.desired_style, ''\)\), ''\) is null/.test(blocks[1]) && /x\.style is not null/.test(blocks[1]));
const setClause = blocks[1].slice(blocks[1].indexOf(" set ") + 5, blocks[1].indexOf(" from ("));
check("it changes nothing but desired_style (the SET clause is exactly one column)", setClause === "desired_style = x.style");
check("the doc warns plainly that it queues the build plans, says to preview first, and says it is owner-run and not applied", /queues that client's website build plan/.test(doc) && /build_plan_queued/.test(doc) && /Step 1: preview/.test(doc) && /Optional, owner-run, NOT applied/.test(doc));
check("the regression test also proves the check stops asking, a client with a style is untouched, a client with no report is untouched, and a second run changes nothing", /Warm, simple, cream and gold\./.test(test) && /an existing style was overwritten/.test(test) && /a client with no report was changed/.test(test) && /not idempotent/.test(test) && /'\[\]'::jsonb/.test(test));

if (failures) { console.log(`\n${failures} check(s) FAILED`); process.exit(1); }
console.log("\nAll checks passed.");
