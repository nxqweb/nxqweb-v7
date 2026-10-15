// Offline test: client-facing Commerce errors show only the reasons our own SQL raises, never Postgres internals,
// and every whitelisted reason really exists in the migrations (so the list cannot drift silently).
import fs from "node:fs";
import path from "node:path";
import { commerceRpcReason, withCommerceReason } from "../src/lib/commerceRpcReason.ts";

let failures = 0;
function check(name, ok, detail = "") { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); } }

const generic = "Product visibility could not be changed.";
check("known reason is shown before the generic text", withCommerceReason(generic, { message: "Product image must be a valid HTTPS URL." }) === `Product image must be a valid HTTPS URL. ${generic}`);
check("postgres internals stay hidden", withCommerceReason(generic, { message: 'new row for relation "products" violates check constraint "x"' }) === generic);
check("network errors stay hidden", withCommerceReason(generic, { message: "TypeError: Failed to fetch" }) === generic);
check("partial matches are not trusted", commerceRpcReason({ message: "Product price is invalid. extra detail from elsewhere" }) === null);
check("null and empty errors fall back to generic", withCommerceReason(generic, null) === generic && withCommerceReason(generic, {}) === generic && withCommerceReason(generic, { message: "" }) === generic);

const src = fs.readFileSync("src/lib/commerceRpcReason.ts", "utf8");
const listed = [...src.matchAll(/^\s+"(.+)",$/gm)].map((m) => m[1]);
const migrationsDir = "supabase/migrations";
const sql = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).map((f) => fs.readFileSync(path.join(migrationsDir, f), "utf8")).join("\n");
check("whitelist is not empty", listed.length >= 8, String(listed.length));
const missing = listed.filter((r) => !sql.includes(`raise exception '${r}'`));
check("every whitelisted reason is raised by a real migration", missing.length === 0, missing.join(" | "));

const page = fs.readFileSync("src/pages/ClientCommerceLiveStore.tsx", "utf8");
check("Live store uses the helper for both save and visibility errors", (page.match(/withCommerceReason\(/g) ?? []).length === 2);

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll commerce-rpc-reason checks passed (offline).");
process.exit(failures ? 1 : 0);
