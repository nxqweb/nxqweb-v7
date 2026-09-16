import fs from "node:fs";

const path = "supabase/functions/build-business-website/index.ts";
let text = fs.readFileSync(path, "utf8");

const oldBlock = `  const currentRes = await timedFetch(\`https://api.netlify.com/api/v1/sites/\${siteId}\`, {\n    headers: netlifyHeaders(token),\n  });\n  const current = await readJson(currentRes);\n  if (!currentRes.ok || !current || Array.isArray(current)) throw new Error(\`Netlify site lookup failed (\${currentRes.status}).\`);\n  const buildSettings = current.build_settings && typeof current.build_settings === "object"\n    ? current.build_settings as JsonRecord\n    : {};\n  const patchRes = await timedFetch(\`https://api.netlify.com/api/v1/sites/\${siteId}\`, {\n    method: "PATCH",\n    headers: netlifyHeaders(token),\n    body: JSON.stringify({\n      build_settings: {\n        ...buildSettings,\n        allowed_branches: [branch],\n        stop_builds: false,\n      },\n    }),\n  });`;

const newBlock = `  const patchRes = await timedFetch(\`https://api.netlify.com/api/v1/sites/\${siteId}\`, {\n    method: "PATCH",\n    headers: netlifyHeaders(token),\n    body: JSON.stringify({\n      build_settings: {\n        allowed_branches: [branch],\n        stop_builds: false,\n      },\n    }),\n  });`;

if (!text.includes(newBlock)) {
  if (!text.includes(oldBlock)) {
    throw new Error("Netlify preview activation source marker did not match current worker.");
  }
  text = text.replace(oldBlock, newBlock);
}

if (text.includes("...buildSettings")) {
  throw new Error("Legacy build_settings spread still exists after patch.");
}

fs.writeFileSync(path, text);
