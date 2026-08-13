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

print('Commerce provisioning gateway now permits protected server-to-server dispatch while retaining source-level auth.')
