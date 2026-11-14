from pathlib import Path

manifest = Path('scripts/edge-function-manifest.mjs')
config = Path('supabase/config.toml')

manifest_text = manifest.read_text()
old_manifest = '  entry("provision-storefront", true, "owner-jwt"),'
new_manifest = '  entry("provision-storefront", false, "trusted-worker-or-owner"),'
if old_manifest in manifest_text:
    manifest_text = manifest_text.replace(old_manifest, new_manifest, 1)
elif new_manifest not in manifest_text:
    raise SystemExit('provision-storefront manifest entry is not in an expected state; refusing ambiguous patch.')
manifest.write_text(manifest_text)

config_text = config.read_text()
old_config = '[functions.provision-storefront]\nverify_jwt = true'
new_config = '[functions.provision-storefront]\nverify_jwt = false'
if old_config in config_text:
    config_text = config_text.replace(old_config, new_config, 1)
elif new_config not in config_text:
    raise SystemExit('provision-storefront config section is not in an expected state; refusing ambiguous patch.')
config.write_text(config_text)

KEY_HELPER = r'''function concatNxqKeyBytes(...parts: Uint8Array[]) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}
function nxqDerLength(length: number) {
  if (length < 0x80) return Uint8Array.of(length);
  const bytes: number[] = [];
  let value = length;
  while (value > 0) { bytes.unshift(value & 0xff); value = Math.floor(value / 256); }
  return Uint8Array.of(0x80 | bytes.length, ...bytes);
}
function nxqDerWrap(tag: number, body: Uint8Array) {
  return concatNxqKeyBytes(Uint8Array.of(tag), nxqDerLength(body.length), body);
}
function nxqPemBodyBytes(pem: string) {
  const body = pem.replace(/-----BEGIN [^-]+-----/g, "").replace(/-----END [^-]+-----/g, "").replace(/\s+/g, "");
  const binary = atob(body);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
function nxqBytesToPem(label: string, bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const encoded = btoa(binary);
  const lines = encoded.match(/.{1,64}/g)?.join("\n") || encoded;
  return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----`;
}
function normalizeGithubPrivateKey(raw: string) {
  let pem = raw.trim();
  if ((pem.startsWith('"') && pem.endsWith('"')) || (pem.startsWith("'") && pem.endsWith("'"))) pem = pem.slice(1, -1);
  pem = pem.replace(/\\n/g, "\n").replace(/\r\n/g, "\n").trim();
  if (pem.includes("-----BEGIN PRIVATE KEY-----")) return pem;
  if (!pem.includes("-----BEGIN RSA PRIVATE KEY-----")) throw new Error("GITHUB_APP_PRIVATE_KEY must be a PKCS#8 or PKCS#1 RSA PEM private key.");
  const pkcs1 = nxqPemBodyBytes(pem);
  const version = Uint8Array.of(0x02, 0x01, 0x00);
  const rsaAlgorithm = Uint8Array.of(0x30,0x0d,0x06,0x09,0x2a,0x86,0x48,0x86,0xf7,0x0d,0x01,0x01,0x01,0x05,0x00);
  const privateKeyOctet = nxqDerWrap(0x04, pkcs1);
  return nxqBytesToPem("PRIVATE KEY", nxqDerWrap(0x30, concatNxqKeyBytes(version, rsaAlgorithm, privateKeyOctet)));
}

'''

def normalize_key_worker(path_text: str, marker: str) -> None:
    path = Path(path_text)
    source = path.read_text()
    if 'function normalizeGithubPrivateKey(' not in source:
        if marker not in source:
            raise SystemExit(f'{path}: GitHub token marker missing; refusing ambiguous patch.')
        source = source.replace(marker, KEY_HELPER + marker, 1)
    replacements = [
        ('secret("GITHUB_APP_PRIVATE_KEY").replace(/\\\\n/g,"\\n")', 'normalizeGithubPrivateKey(secret("GITHUB_APP_PRIVATE_KEY"))'),
        ('requiredSecret("GITHUB_APP_PRIVATE_KEY").replace(/\\\\n/g, "\\n")', 'normalizeGithubPrivateKey(requiredSecret("GITHUB_APP_PRIVATE_KEY"))'),
    ]
    for old, new in replacements:
        source = source.replace(old, new)
    if 'importPKCS8(normalizeGithubPrivateKey(' not in source:
        raise SystemExit(f'{path}: GitHub private key was not normalized after patch.')
    path.write_text(source)

normalize_key_worker('supabase/functions/build-business-location-pages/index.ts', 'async function githubToken(){')
normalize_key_worker('supabase/functions/build-business-seo-artifacts/index.ts', 'async function githubToken(){')
normalize_key_worker('supabase/functions/run-website-maintenance/index.ts', 'async function githubInstallationToken() {')

maintenance = Path('supabase/functions/run-website-maintenance/index.ts')
maintenance_text = maintenance.read_text()
old_token_fetch = '  const tokenRes = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {'
new_token_fetch = '  const { res: tokenRes } = await timedFetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {'
if old_token_fetch in maintenance_text:
    maintenance_text = maintenance_text.replace(old_token_fetch, new_token_fetch, 1)
elif new_token_fetch not in maintenance_text:
    raise SystemExit('Maintenance GitHub token fetch is not in an expected state.')
maintenance.write_text(maintenance_text)

infra = Path('supabase/functions/provision-project-infrastructure/index.ts')
infra_text = infra.read_text()
install_marker = '        installation_id: installationId,\n'
if '        stop_builds: true,\n' not in infra_text:
    if install_marker not in infra_text:
        raise SystemExit('Infrastructure Netlify installation marker missing.')
    infra_text = infra_text.replace(install_marker, install_marker + '        stop_builds: true,\n', 1)
start = infra_text.find('async function triggerBaselineBuild(siteId: string) {')
if start >= 0:
    end = infra_text.find('\nDeno.serve(async (request) => {', start)
    if end < 0:
        raise SystemExit('Infrastructure baseline build function end marker missing.')
    infra_text = infra_text[:start] + infra_text[end+1:]
old_call = '''    if (!checkpoint.baseline_build_id) {
      const build = await triggerBaselineBuild(netlifySiteId);
      await saveCheckpoint({
        checkpoint: "baseline_build_started",
        baseline_build_id: typeof build.id === "string" ? build.id : null,
      });
    }

'''
if old_call in infra_text:
    infra_text = infra_text.replace(old_call, '', 1)
if 'builds?branch=main' in infra_text or 'triggerBaselineBuild(' in infra_text:
    raise SystemExit('Infrastructure worker still contains a baseline production-main build trigger.')
infra.write_text(infra_text)

builder = Path('supabase/functions/build-business-website/index.ts')
builder_text = builder.read_text()
if 'async function activateNetlifyBuilds(siteId: string)' not in builder_text:
    marker = 'async function triggerBranchBuild(siteId: string, branch: string) {'
    if marker not in builder_text:
        raise SystemExit('Business preview trigger marker missing.')
    helper = r'''async function activateNetlifyBuilds(siteId: string) {
  const token = requiredSecret("NETLIFY_ACCESS_TOKEN");
  const res = await timedFetch(`https://api.netlify.com/api/v1/sites/${siteId}`, {
    method: "PATCH",
    headers: netlifyHeaders(token),
    body: JSON.stringify({ build_settings: { stop_builds: false } }),
  });
  const body = await readJson(res);
  if (!res.ok) throw new Error(`Netlify preview build activation failed (${res.status}): ${String(body?.message || body?.error || "Unknown error")}`);
}

'''
    builder_text = builder_text.replace(marker, helper + marker, 1)
old_trigger = '  const build = await triggerBranchBuild(configRes.data.netlify_site_id, sourceBranch);'
new_trigger = '  await activateNetlifyBuilds(configRes.data.netlify_site_id);\n  const build = await triggerBranchBuild(configRes.data.netlify_site_id, sourceBranch);'
if old_trigger in builder_text:
    builder_text = builder_text.replace(old_trigger, new_trigger, 1)
elif new_trigger not in builder_text:
    raise SystemExit('Business preview build call is not in an expected state.')
builder.write_text(builder_text)

print('Runtime gateway, GitHub key compatibility, provider timeout, and pre-preview Netlify publish protections applied.')
