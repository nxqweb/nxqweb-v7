// Guards two things: (1) the client-facing signup/setup forms do not hint that the product is only for tree services (the owner serves any business),
// (2) the "Take action" link on the client home jumps to the setup sheet that is on the same page.
import fs from "node:fs";

let failures = 0;
const check = (name, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures += 1; };
const read = (p) => fs.readFileSync(p, "utf8");

const formFiles = ["src/pages/PortalSignup.tsx", "src/lib/productCatalog.ts", "src/pages/ClientBusinessLocations.tsx"];
for (const f of formFiles) check(`${f} has no tree-service example text`, !/tree|storm|stump|Oroville|Chico/i.test(read(f)));

const portal = read("src/pages/ClientPortal.tsx");
const forms = portal.split("\n").filter((l) => /placeholder/.test(l)).join("\n");
check("ClientPortal.tsx setup-sheet placeholders have no tree-service example text", !/tree|storm|stump|Oroville|Chico/i.test(forms));
check("ClientPortal.tsx plan blurb does not name only tree services", !/contractors, tree services/.test(portal));
check("the setup sheet section has the jump target id", portal.includes('id="website-setup-sheet"'));
check("Take action jumps to the setup sheet when the action points at this page", read("src/components/ClientPortalTopCards.tsx").includes('"/client#website-setup-sheet"'));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll neutral wording checks passed.");
process.exit(failures ? 1 : 0);
