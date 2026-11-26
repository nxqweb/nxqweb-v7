// Guards the client file upload feedback: its result must appear next to the Upload button, not only at the top of a long page.
import fs from "node:fs";

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`PASS  ${name}`);
  else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); }
}
const page = fs.readFileSync("src/pages/ClientPortal.tsx", "utf8");
const start = page.indexOf("async function uploadClientFile()");
const end = page.indexOf("function normalizeDomainInput", start);
const fn = page.slice(start, end);
const panel = page.slice(page.indexOf("<h2>Upload files</h2>"), page.indexOf("<h2>Upload files</h2>") + 3000);

check("the upload function reports through its own status, not the page-top banner", fn.includes("setUploadStatus") && !fn.includes("setErrorMessage") && !fn.includes("setNotice"));
check("every failure path tells the client something", (fn.match(/tone: "error"/g) || []).length >= 8);
check("success tells the client the file is being scanned", fn.includes('tone: "success"') && fn.includes("file security is scanning it"));
check("the status is cleared at the start of each attempt", /async function uploadClientFile\(\) \{\s*setUploadStatus\(null\)/.test(fn));
check("the status is rendered inside the Upload files panel, right after the button", panel.indexOf("uploadStatus ?") > panel.indexOf("Upload file") && panel.indexOf("uploadStatus ?") < panel.indexOf("message-list"));
check("errors are announced to assistive tech and success is a polite status", panel.includes('role={uploadStatus.tone === "error" ? "alert" : "status"}'));
check("the button shows progress while uploading", panel.includes('isUploadingFile ? "Uploading file..." : "Upload file"'));
check("the allowed-type and size rules are still enforced before upload", fn.includes("allowedFileTypes.has(selectedFile.type)") && fn.includes("25 * 1024 * 1024"));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll client upload feedback checks passed.");
process.exit(failures ? 1 : 0);
