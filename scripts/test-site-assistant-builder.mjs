// Offline test for how the website Q&A widget reaches a client's site: the file is in the template and the builder's file lists, the button is written into a site's
// config ONLY for a client who turned My assistant on (and only when the lead form exists), a missing/unreadable setting means off (a build never fails over it), the example
// sites never get it, and the privacy/terms words exist. The widget's own behavior is covered by test-site-assistant-ui and the real-browser check.
import fs from "node:fs";

let failures = 0;
function check(name, ok) { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}`); } }
const read = (p) => fs.readFileSync(p, "utf8");
const builder = read("supabase/functions/build-business-website/index.ts");
const evidence = read("supabase/functions/run-staging-evidence-suite/index.ts");
const index = read("templates/business-v1/index.html");
const examples = read("scripts/build-example-sites.mjs");
const widget = read("templates/business-v1/assistant.js");

check("the widget file lives in the Business template", fs.existsSync("templates/business-v1/assistant.js") && !fs.existsSync("docs/drafts/site/assistant.js"));
check("the template loads it as a module next to the other scripts", /<script type="module" src="\.\/assistant\.js"><\/script>/.test(index));
check("the builder copies it into every generated site, and the staging evidence suite requires it", /const blueprintFiles = \[[^\]]*"assistant\.js"\]/.test(builder) && /const requiredFiles = \[[^\]]*"assistant\.js"\]/.test(evidence));
check("the example sites strip the script (they have no backend)", /replace\('    <script type="module" src=".\/assistant\.js"><\/script>\\n', ""\)/.test(examples));

check("the builder reads the client's own on/off setting with the service role, and treats an error as off", /from\("client_assistant_settings"\)\.select\("enabled"\)\.eq\("client_id", job\.client_id\)\.maybeSingle\(\)/.test(builder) && /assistant_enabled: !assistantSettings\.error && assistantSettings\.data\?\.enabled === true/.test(builder));
check("the answer address is derived from the lead address, and empty when the lead address has another shape", /leadEndpoint\.replace\(\/\\\/ingest-business-lead\\\/\?\$\/, "\/answer-site-question"\)/.test(builder) && /assistant_endpoint: assistantEndpoint !== leadEndpoint \? assistantEndpoint : ""/.test(builder));
check("the assistant block is written only when it is on AND the lead endpoint and form key exist", /const assistantOn = runtime\.assistant_enabled === true && Boolean\(assistantEndpoint && leadEndpoint && leadFormKey\);/.test(builder) && /\.\.\.\(assistantOn \? \{ assistant: \{ enabled: true, endpoint: assistantEndpoint, formKey: leadFormKey, title: "Ask a question" \} \} : \{\}\),/.test(builder));
check("the block never carries the greeting or any answer (they are fetched live, so edits need no rebuild)", !/assistant: \{[^}]*(greeting|answer|fallback)/.test(builder));

check("the widget starts only when the config says enabled === true, and shows nothing if the config cannot load", /if \(config\.enabled !== true\) return;/.test(widget) && /catch \{ \/\* no assistant \*\/ \}/.test(widget));
check("the widget only talks to an https address and never reads answers as HTML", /https:\\\/\\\//.test(widget) && !/innerHTML/.test(widget));

const privacy = read("templates/business-v1/privacy.html");
const legal = read("src/lib/legalContent.ts");
check("the client-site privacy page and the NXQX privacy policy both explain saved unanswered questions", /Ask a question button/.test(privacy) && /may be saved/.test(privacy) && /The Ask a question button on client websites/.test(legal) && /do not save the visitor's IP address/.test(legal));
check("the NXQX terms say the business is responsible for the answers it writes, and that the button is not a person or a promise", /Answers you write for your website/.test(legal) && /You are responsible for those answers/.test(legal) && /not a person or a promise from NXQX-Web/.test(legal));

if (failures) { console.log(`\n${failures} check(s) FAILED`); process.exit(1); }
console.log("\nAll checks passed.");
