// Offline test: analytics never records query strings or fragments (they can carry personal data), at the browser script and at ingest.
import fs from "node:fs";
import { pagePathOnly } from "../supabase/functions/_shared/analytics-path.ts";

let failures = 0;
function check(name, ok, detail = "") { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); } }

check("plain path is kept", pagePathOnly("/services") === "/services");
check("query string is removed", pagePathOnly("/contact?email=jane@example.com&token=abc") === "/contact");
check("fragment is removed", pagePathOnly("/about#team") === "/about");
check("query and fragment together are removed", pagePathOnly("/p?a=1#b") === "/p");
check("a full URL is reduced to its path", pagePathOnly("https://shop.example.com/menu?utm_source=x") === "/menu");
check("missing, empty or non-string values become /", pagePathOnly(undefined) === "/" && pagePathOnly("") === "/" && pagePathOnly(42) === "/" && pagePathOnly("?only=query") === "/");
check("a path without a leading slash gets one", pagePathOnly("pricing") === "/pricing");
check("path is bounded to 500 characters", pagePathOnly("/" + "a".repeat(900)).length <= 500);

const script = fs.readFileSync("templates/business-v1/analytics.js", "utf8");
check("browser script records only the pathname", script.includes("window.location.pathname.slice(0, 500)") && !script.includes("window.location.search"));
const ingest = fs.readFileSync("supabase/functions/ingest-business-analytics/index.ts", "utf8");
check("ingest strips query strings and fragments from page_path", ingest.includes("page_path: pagePathOnly(event.page_path)") && ingest.includes('from "../_shared/analytics-path.ts"'));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll analytics path-privacy checks passed (offline).");
process.exit(failures ? 1 : 0);
