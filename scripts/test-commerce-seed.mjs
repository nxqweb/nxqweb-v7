// Offline guard for the owner-run store-fill script: the SQL tested on real Postgres is word for word the SQL in commerce-seed.sql, the generator builds a runnable script from the sample,
// and it refuses the mistakes the database would refuse. (The database behavior itself is proven by scripts/sql/local-full-schema/regression/commerce_seed.test.sql.)
import fs from "node:fs";
import { buildSeed } from "./make-commerce-seed.mjs";

let failures = 0;
function check(name, ok) { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}`); } }
const read = (p) => fs.readFileSync(p, "utf8");
const sql = read("scripts/sql/commerce-seed.sql");
const test = read("scripts/sql/local-full-schema/regression/commerce_seed.test.sql");
const sample = read("docs/CANDLE_STORE_SAMPLE.json");

const body = sql.slice(sql.indexOf("do $$") + "do $$".length, sql.lastIndexOf("end $$;"));
const wrapped = test.slice(test.indexOf("$nxqseed$") + "$nxqseed$".length, test.indexOf("end\n$nxqseed$;"));
check("the SQL tested on real Postgres is word for word the SQL in commerce-seed.sql", body.length > 1000 && body === wrapped);
check("the script no longer says it is untested, and says where the proof is", !/UNTESTED/.test(sql) && /commerce_seed\.test\.sql/.test(sql));
check("the script still refuses unapproved clients, inactive billing, QA clients and taken web names", /not approved yet/.test(sql) && /billing is not active yet/.test(sql) && /QA-only test client/.test(sql) && /already taken/.test(sql));

const out = buildSeed(sample, sql);
check("the generator prints a runnable script: the set_config line, then the exact DO block", out.includes("select set_config('nxq.commerce_seed', $nxq$") && out.includes(sql.slice(sql.indexOf("do $$")).trimEnd()));
const embedded = JSON.parse(out.slice(out.indexOf("$nxq$") + 5, out.indexOf("$nxq$, false);")));
check("the details survive intact (store name, slug, two products, still not live)", embedded.store_name === "Her Candle Shop" && embedded.store_slug === "her-candle-shop" && embedded.products.length === 2 && embedded.make_live === false);

const bad = (change) => { const j = JSON.parse(sample); change(j); try { buildSeed(JSON.stringify(j), sql); return false; } catch { return true; } };
check("it refuses a missing/bad email, store name, web name, payment link, price and duplicate product names", [
  (j) => { j.client_email = "nope"; }, (j) => { j.store_name = ""; }, (j) => { j.store_slug = "Bad Name!"; },
  (j) => { j.stripe_payment_link = "https://evil.example.com/x"; }, (j) => { j.products[0].base_price = "free"; }, (j) => { j.products[1].name = "lavender calm candle"; },
  (j) => { j.make_live = true; j.stripe_payment_link = ""; }, (j) => { j.store_name = "x $nxq$ y"; },
].every(bad));
let notJson = false; try { buildSeed("{ nope", sql); } catch { notJson = true; }
check("it explains a file that is not valid JSON", notJson);
check("the sample uses a clearly fake email and a placeholder payment link (nothing real is stored in the repo)", /example\.com/.test(sample) && /PASTE_HER_LINK_HERE/.test(sample));

if (failures) { console.log(`\n${failures} check(s) FAILED`); process.exit(1); }
console.log("\nAll checks passed.");
