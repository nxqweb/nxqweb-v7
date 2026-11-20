// Offline test: plain words when the server refuses a photo upload (src/lib/uploadDenied.ts) and the phone-sized Report a problem button.
// Found 2026-11-18: a test account stuck in billing freeze review saw only "Images could not be uploaded", with no hint why.
import fs from "node:fs";
import { uploadDeniedFromError, uploadDeniedMessage } from "../src/lib/uploadDenied.ts";

let failures = 0;
function check(name, ok, detail = "") { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); } }

const known = [
  "Upload denied by account, tier, or billing state.",
  "Commerce storage requires a Commerce subscription.",
  "Upload denied by monthly storage limit.",
  "Upload size or type is invalid.",
  "Authenticated client access required.",
];
check("every refusal the server can give about the client's own account or file gets plain words", known.every((m) => typeof uploadDeniedMessage(m) === "string" && uploadDeniedMessage(m).length > 30));
check("the plain words never repeat the server's sentence or database words", known.every((m) => { const t = uploadDeniedMessage(m); return !/denied by|P0001|raise|exception|tier,|storage requires/i.test(t); }));
check("the account refusal says what to do (approved, billing active, message NXQX)", /approved with billing active/.test(uploadDeniedMessage(known[0])) && /message NXQX/i.test(uploadDeniedMessage(known[0])));
check("the file refusal says which pictures work", /JPG, PNG, WEBP or GIF/.test(uploadDeniedMessage(known[3])) && /8 MB/.test(uploadDeniedMessage(known[3])));
check("an unknown, empty or odd reason returns nothing (the page keeps its generic message)", [undefined, null, "", "boom", 5, {}, "Upload path is outside this client workspace.", "Upload ticket could not be issued.", "Unsupported upload bucket."].every((v) => uploadDeniedMessage(v) === null));
check("it matches the sentence even with other text around it, and ignores case", uploadDeniedMessage("ERROR: upload DENIED by account, tier, or billing state. (P0001)") !== null);
check("it works on the error the helper throws, and on anything else without crashing", uploadDeniedFromError({ reason: known[0] }) === uploadDeniedMessage(known[0]) && [undefined, null, "x", new Error("x"), { reason: 7 }].every((v) => uploadDeniedFromError(v) === null));

const helper = fs.readFileSync("src/lib/storageUploadAuthorization.ts", "utf8");
check("the helper keeps its old message for every existing caller and carries the server's sentence (capped) in reason", helper.includes('super("Storage upload authorization was denied.")') && helper.includes("throw new UploadDeniedError(") && helper.includes(".slice(0, 400)"));
const manager = fs.readFileSync("src/components/ProductImageManager.tsx", "utf8");
check("the photo page shows the plain words, and keeps its old line when the reason is unknown", manager.includes("const plainReason = uploadDeniedFromError(caught);") && manager.includes('setError(plainReason ?? "Images could not be uploaded. No storefront publish was triggered.");'));
check("the server's raw sentence is never put on the page", !/result\.error\.message|\.reason\b.*setError|setError\([^)]*caught/.test(manager));

const css = fs.readFileSync("src/styles/plan-forms.css", "utf8");
const report = fs.readFileSync("src/components/ReportProblem.tsx", "utf8");
check("on a phone the Report a problem button is a 44px round flag so it stops covering page buttons", /@media \(max-width: 640px\) \{\s*\.report-problem-btn \{[^}]*width: 44px;[^}]*height: 44px;/.test(css));
check("its words stay for screen readers and wide screens (aria-label plus a visually hidden label on phones)", report.includes('aria-label="Report a problem"') && report.includes('<span className="report-problem-label">Report a problem</span>') && /\.report-problem-btn \.report-problem-label \{ position: absolute; width: 1px; height: 1px;/.test(css));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll upload-denied checks passed (offline).");
process.exit(failures ? 1 : 0);
