// New client Netlify sites must start with builds stopped, otherwise every new site spends production-deploy credits on its own
// (QA run #2: 2 production deploys at 15 credits each for a site that never got a plan). Netlify ignores `stop_builds` when it is sent
// inside the `repo` object of POST /sites, so it is applied here with PATCH build_settings and then READ BACK; if Netlify did not
// really stop builds this throws instead of letting the project record a false "builds stopped".
export type NetlifyRequest = (url: string, init?: { method?: string; body?: string }) => Promise<{ ok: boolean; status: number; json: unknown }>;

type JsonRecord = Record<string, unknown>;
const asRecord = (value: unknown): JsonRecord => (value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {});

export async function ensureNetlifyBuildsStopped(siteId: string, request: NetlifyRequest) {
  const base = `https://api.netlify.com/api/v1/sites/${encodeURIComponent(siteId)}`;
  const current = await request(base);
  if (!current.ok) throw new Error(`Netlify site lookup before stopping builds failed (${current.status}).`);
  const existing = asRecord(asRecord(current.json).build_settings);
  if (existing.stop_builds === true) return { changed: false };

  const patched = await request(base, {
    method: "PATCH",
    body: JSON.stringify({ build_settings: { ...existing, stop_builds: true } }),
  });
  if (!patched.ok) throw new Error(`Netlify could not stop builds for the new site (${patched.status}).`);

  const verified = await request(base);
  if (!verified.ok || asRecord(asRecord(verified.json).build_settings).stop_builds !== true) {
    throw new Error("Netlify did not confirm that builds are stopped for the new site; refusing to record builds as stopped.");
  }
  return { changed: true };
}
