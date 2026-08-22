import fs from "node:fs";
import path from "node:path";
const root="templates/business-v1";
const read=(p)=>fs.readFileSync(path.join(root,p),"utf8");
const size=(p)=>fs.statSync(path.join(root,p)).size;
const index=read("index.html");const headers=read("_headers");const css=read("styles.css");const a11y=read("a11y.css");const app=read("app.js");const analytics=read("analytics.js");const lead=read("lead-form.js");const config=read("site.config.js");const privacy=read("privacy.html");const terms=read("terms.html");const accessibility=read("accessibility.html");const notFound=read("404.html");const robots=read("robots.txt");
const all=[index,headers,css,a11y,app,analytics,lead,config,privacy,terms,accessibility,notFound,robots].join("\n");
const checks=[
["Template has semantic main content",/<main[\s>]/i.test(index)],
["Template has a skip link",/skip/i.test(index)&&/href=["']#main/i.test(index)],
["Template declares viewport",/name=["']viewport/i.test(index)],
["Template has title and description hooks",/<title/i.test(index)&&/name=["']description/i.test(index)],
["Template has lead form progressive fallback",lead.includes("formKey")&&lead.includes("endpoint")],
["Lead form renders and submits Cloudflare Turnstile",lead.includes("challenges.cloudflare.com/turnstile")&&lead.includes("turnstile.render")&&lead.includes("challenge_token")&&lead.includes("turnstile.reset")],
["Analytics never reads input values",!analytics.includes(".value")&&!analytics.includes("FormData")&&!analytics.includes("keydown")&&!analytics.includes("keyup")],
["Analytics requires consent",analytics.toLowerCase().includes("consent")],
["Security headers include CSP",/Content-Security-Policy/i.test(headers)],
["Security policy permits only the Turnstile challenge origin",headers.includes("script-src 'self' https://challenges.cloudflare.com")&&headers.includes("frame-src https://challenges.cloudflare.com")],
["Security headers include HSTS",/Strict-Transport-Security/i.test(headers)],
["Security headers include nosniff",/X-Content-Type-Options:\s*nosniff/i.test(headers)],
["Security headers include referrer policy",/Referrer-Policy/i.test(headers)],
["Reduced motion is supported",/prefers-reduced-motion/i.test(a11y+css)],
["Keyboard focus is visibly supported",/:focus-visible/i.test(a11y+css)],
["Privacy page exists",privacy.length>100],
["Terms page exists",terms.length>100],
["Accessibility page exists",accessibility.length>100],
["404 page exists",notFound.length>80],
["robots.txt exists",/User-agent:/i.test(robots)],
["Template contains no insecure HTTP asset URLs",!/(src|href)=["']http:\/\//i.test(all)],
["Template config contains no real client identity",!/(Light of the World|candlelightoftheworld|530\) 912-9067)/i.test(config)],
["Static app JS stays dependency-light",!/(from\s+["'](?:react|vue|angular)|require\()/i.test(app+analytics+lead)],
["Core CSS stays below 180 KB",size("styles.css")<180*1024],
["Core app JS stays below 100 KB",size("app.js")<100*1024],
["Analytics JS stays below 80 KB",size("analytics.js")<80*1024],
["Lead form JS stays below 80 KB",size("lead-form.js")<80*1024],
];
let passed=0;for(const [label,ok] of checks){if(ok){console.log(`PASS  ${label}`);passed++;}else console.error(`FAIL  ${label}`);}console.log(`\n${passed}/${checks.length} generated Business site quality checks passed.`);if(passed!==checks.length)process.exit(1);
