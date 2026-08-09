import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

if (!fs.existsSync("dist/index.html")) {
  console.error("dist/index.html is missing. Run npm run build first.");
  process.exit(1);
}

const port = 4179;
const viteBin = path.join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "vite.cmd" : "vite");
const server = spawn(viteBin, ["preview", "--host", "127.0.0.1", "--port", String(port)], {
  cwd: process.cwd(),
  stdio: ["ignore", "pipe", "pipe"],
});
let serverOutput = "";
server.stdout.on("data", (chunk) => { serverOutput += chunk.toString(); });
server.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
async function waitForReady() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      if (response.ok) return;
    } catch {
      // Preview startup is intentionally retried for up to five seconds.
    }
    await wait(100);
  }
  throw new Error(`Vite preview did not become ready.\n${serverOutput}`);
}

const routes = [
  "/", "/plans", "/portal", "/portal/login", "/client", "/client/journey", "/client/history", "/client/business",
  "/client/business/analytics", "/owner", "/owner/exceptions", "/owner/launch-readiness", "/owner/sales", "/store/demo",
];

try {
  await waitForReady();
  for (const route of routes) {
    const response = await fetch(`http://127.0.0.1:${port}${route}`);
    const body = await response.text();
    if (response.status !== 200 || !body.includes('<div id="root"></div>')) {
      throw new Error(`${route} failed SPA fallback smoke check with HTTP ${response.status}.`);
    }
    console.log(`PASS  ${route} -> ${response.status}`);
  }
  const index = fs.readFileSync("dist/index.html", "utf8");
  const asset = index.match(/\/assets\/index-[A-Za-z0-9_-]+\.js/)?.[0];
  if (!asset) throw new Error("Production entry asset was not found in dist/index.html.");
  const assetResponse = await fetch(`http://127.0.0.1:${port}${asset}`);
  if (!assetResponse.ok || (await assetResponse.text()).length === 0) throw new Error("Production entry asset is unavailable.");
  console.log(`PASS  production entry asset -> ${assetResponse.status}`);
  console.log(`\n${routes.length} application routes and the production entry asset passed smoke checks.`);
} finally {
  server.kill("SIGTERM");
}
