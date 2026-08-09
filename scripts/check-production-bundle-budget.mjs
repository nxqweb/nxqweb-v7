import fs from "node:fs";
import path from "node:path";

const assetsDir=path.resolve("dist/assets");
if(!fs.existsSync(assetsDir)){console.error("FAIL  dist/assets does not exist. Run the production build first.");process.exit(1);}
const files=fs.readdirSync(assetsDir).filter((name)=>name.endsWith(".js"));
if(files.length===0){console.error("FAIL  No production JavaScript bundles found.");process.exit(1);}
const hardLimit=950_000;
let failed=false;
for(const name of files){const bytes=fs.statSync(path.join(assetsDir,name)).size;const kb=(bytes/1000).toFixed(1);if(bytes>hardLimit){console.error(`FAIL  ${name} is ${kb} KB, above the ${hardLimit/1000} KB hard budget.`);failed=true;}else console.log(`PASS  ${name} is ${kb} KB (budget ${hardLimit/1000} KB).`);}
if(failed)process.exit(1);
console.log(`\n${files.length} production JavaScript bundle(s) are within the hard regression budget.`);
