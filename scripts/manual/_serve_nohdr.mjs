// Serves a PRODUCTION build (default ./dist, or the folder given as the first argument) the way Netlify will: single-page fallback to index.html and the
// exact security headers from netlify.toml (including the Content-Security-Policy, which the dev server does NOT apply). Used by prod-rehearsal.mjs.
// Build a rehearsal copy that talks to a mocked Supabase with:
//   VITE_SUPABASE_URL=https://mock.supabase.co VITE_SUPABASE_ANON_KEY=mock-anon-key npx vite build --outDir /some/folder --emptyOutDir
// then: node scripts/manual/serve-dist.mjs /some/folder 5300
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const root = path.resolve(process.argv[2] || "dist");
const port = Number(process.argv[3] || 5300);
const toml = fs.readFileSync("netlify.toml", "utf8");
const blocks = [...toml.matchAll(/\[\[headers\]\]\s*for = "([^"]+)"\s*\[headers\.values\]([\s\S]*?)(?=\n\[\[|\n*$)/g)].map((m) => ({
  pattern: m[1],
  values: Object.fromEntries([...m[2].matchAll(/^\s*([A-Za-z-]+)\s*=\s*"([^"]*)"/gm)].map((v) => [v[1], v[2]])),
}));
const matches = (pattern, url) => (pattern === "/*" ? true : pattern.endsWith("/*") ? url.startsWith(pattern.slice(0, -1)) : url === pattern);
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".woff2": "font/woff2", ".txt": "text/plain", ".map": "application/json" };

http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || "/").split("?")[0]);
  let file = path.join(root, url);
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  let servedPath = url;
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { file = path.join(root, "index.html"); servedPath = "/index.html"; }
  const headers = { "Content-Type": types[path.extname(file)] || "application/octet-stream" };
  for (const block of blocks) if (matches(block.pattern, servedPath) || matches(block.pattern, url)) void 0;
  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
}).listen(port, "127.0.0.1", () => console.log(`serving ${root} on http://127.0.0.1:${port} with ${blocks.length} header blocks from netlify.toml`));
