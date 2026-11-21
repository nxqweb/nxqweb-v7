from pathlib import Path

files = [
    Path('supabase/functions/provision-project-infrastructure/index.ts'),
    Path('supabase/functions/prepare-build-plan/index.ts'),
    Path('supabase/functions/build-business-website/index.ts'),
    Path('supabase/functions/promote-business-production/index.ts'),
]

for path in files:
    text = path.read_text()

    # Add the unique lease token to each worker's job contract.
    marker = 'type AutomationJob = {\n  id: string;\n'
    assert marker in text, f'missing AutomationJob marker in {path}'
    text = text.replace(marker, 'type AutomationJob = {\n  id: string;\n  lock_token: string;\n', 1)

    # Require the token during claim normalization so no legacy/null-token claim can
    # accidentally enter the v2 worker path.
    normalize_markers = [
        'if (!job.id || !job.client_id || !job.project_id) throw new Error("Automation claim is missing job, client, or project id.");',
        'if (!job.id || !job.client_id) throw new Error("Build-plan claim is missing job or client id.");',
        'if (!job.id || !job.client_id || !job.project_id || !job.job_type) throw new Error("Website build claim is missing required ids.");',
        'if (!job.id || !job.client_id || !job.project_id || !job.job_type) throw new Error("Production claim is missing required ids.");',
    ]
    found = False
    for old in normalize_markers:
        if old in text:
            prefix = old[:-2] if old.endswith(');') else old
            # Keep exact error wording but extend condition.
            condition, rest = old.split(' throw ', 1)
            if '!job.lock_token' not in condition:
                condition = condition[:-1] + ' || !job.lock_token)'
            text = text.replace(old, condition + ' throw ' + rest, 1)
            found = True
            break
    assert found, f'missing normalize marker in {path}'

    text = text.replace('admin.rpc("claim_next_external_automation_job", {', 'admin.rpc("claim_next_external_automation_job_v2", {')
    text = text.replace('admin.rpc("complete_external_automation_job", {', 'admin.rpc("complete_external_automation_job_v2", {')
    text = text.replace('admin.rpc("fail_external_automation_job", {', 'admin.rpc("fail_external_automation_job_v2", {')
    text = text.replace('admin.rpc("defer_external_automation_job", {', 'admin.rpc("defer_external_automation_job_v2", {')

    # Every state-mutating v2 RPC is fenced with the exact claim token.
    for rpc in [
        'complete_external_automation_job_v2',
        'fail_external_automation_job_v2',
        'defer_external_automation_job_v2',
    ]:
        needle = f'admin.rpc("{rpc}", {{\n      target_job_id: job.id,\n'
        replacement = f'admin.rpc("{rpc}", {{\n      target_job_id: job.id,\n      target_lock_token: job.lock_token,\n'
        text = text.replace(needle, replacement)

    assert 'claim_next_external_automation_job_v2' in text, f'v2 claim missing in {path}'
    for legacy in [
        'admin.rpc("claim_next_external_automation_job",',
        'admin.rpc("complete_external_automation_job",',
        'admin.rpc("fail_external_automation_job",',
        'admin.rpc("defer_external_automation_job",',
    ]:
        assert legacy not in text, f'legacy RPC remains in {path}: {legacy}'

    # Complete and failure are mandatory for all four workers.
    assert 'target_lock_token: job.lock_token' in text, f'lease fence missing in {path}'
    path.write_text(text)
    print(f'patched {path}')
