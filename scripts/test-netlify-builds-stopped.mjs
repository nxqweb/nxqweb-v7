// Offline test: new Netlify sites must really end up with builds stopped (verified by read-back), not just claim it.
import fs from "node:fs";
import { ensureNetlifyBuildsStopped } from "../supabase/functions/_shared/netlify-builds.ts";

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`PASS  ${name}`);
  else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); }
}
async function rejects(promise, fragment) {
  try { await promise; return false; } catch (error) { return String(error?.message || error).includes(fragment); }
}

// Fake Netlify: `honors` decides whether PATCH really stores stop_builds.
let lastPatchKeys = [];
function fakeNetlify({ honors = true, startStopped = false, patchStatus = 200 } = {}) {
  const site = { build_settings: { repo_path: "acme/site", cmd: "", stop_builds: startStopped } };
  const calls = [];
  const request = async (url, init = {}) => {
    calls.push(`${init.method || "GET"} ${url}`);
    if (init.method === "PATCH") {
      if (patchStatus !== 200) return { ok: false, status: patchStatus, json: {} };
      const body = JSON.parse(init.body);
      lastPatchKeys = Object.keys(body.build_settings);
      // Real Netlify answered 400 when the PATCH echoed read-only build_settings fields back (run #4).
      if (lastPatchKeys.some((key) => key !== "stop_builds")) return { ok: false, status: 400, json: { message: "read-only field" } };
      if (honors) site.build_settings = { ...site.build_settings, ...body.build_settings };
      return { ok: true, status: 200, json: site };
    }
    return { ok: true, status: 200, json: site };
  };
  return { request, calls, site };
}

{
  const f = fakeNetlify();
  const result = await ensureNetlifyBuildsStopped("site-1", f.request);
  check("stops builds with PATCH build_settings and keeps the repo settings", result.changed === true && f.site.build_settings.stop_builds === true && f.site.build_settings.repo_path === "acme/site");
  check("PATCH body carries only stop_builds (no echoed read-only fields)", lastPatchKeys.length === 1 && lastPatchKeys[0] === "stop_builds");
  check("reads the site back after patching", f.calls.length === 3 && f.calls[1].startsWith("PATCH") && f.calls[2].startsWith("GET"));
}
{
  const f = fakeNetlify({ startStopped: true });
  const result = await ensureNetlifyBuildsStopped("site-1", f.request);
  check("already-stopped site is left alone (idempotent retry)", result.changed === false && f.calls.length === 1);
}
{
  const f = fakeNetlify({ honors: false });
  check("fails closed when Netlify ignores the setting", await rejects(ensureNetlifyBuildsStopped("site-1", f.request), "did not confirm"));
}
{
  const f = fakeNetlify({ patchStatus: 422 });
  check("fails when the PATCH is rejected and says why", await rejects(ensureNetlifyBuildsStopped("site-1", f.request), "could not stop builds"));
}

const infra = fs.readFileSync("supabase/functions/provision-project-infrastructure/index.ts", "utf8");
const verifyAt = infra.indexOf("await verifyNetlifySiteBinding(netlifySiteId");
const stopAt = infra.indexOf("await ensureNetlifyBuildsStopped(netlifySiteId");
const checkpointAt = infra.indexOf("netlify_builds_stopped: true");
check("provisioning stops builds after binding and before it records builds as stopped", verifyAt > 0 && stopAt > verifyAt && checkpointAt > stopAt);

const storefront = fs.readFileSync("supabase/functions/provision-storefront/index.ts", "utf8");
const savedAt = storefront.indexOf('netlify_site_id: String(site.id)');
const sfStopAt = storefront.indexOf("await ensureNetlifyBuildsStopped(String(site.id)");
const sfReturnAt = storefront.indexOf('status: "netlify_site_created" });');
check("Commerce storefront also stops builds for real, after the site id is saved and before it returns", savedAt > 0 && sfStopAt > savedAt && sfReturnAt > sfStopAt);

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll Netlify builds-stopped checks passed (offline; does not prove a live Netlify call).");
process.exit(failures ? 1 : 0);
