from pathlib import Path

TARGETS = [
    'supabase/functions/check-preview-deployment-safety/index.ts',
    'supabase/functions/check-production-launch-audit/index.ts',
    'supabase/functions/check-provider-health/index.ts',
    'supabase/functions/classify-business-change-request/index.ts',
    'supabase/functions/dispatch-notifications/index.ts',
    'supabase/functions/generate-business-build-plan/index.ts',
    'supabase/functions/ingest-business-lead/index.ts',
    'supabase/functions/prepare-build-plan/index.ts',
    'supabase/functions/provider-health-adapter/index.ts',
    'supabase/functions/reconcile-domain/index.ts',
    'supabase/functions/run-website-maintenance/index.ts',
    'supabase/functions/scan-client-file/index.ts',
]

HELPER = r'''async function boundedProviderFetch(input: string | URL | Request, init: RequestInit = {}, timeoutMs = 15_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Provider network request failed.";
    return new Response(message, { status: 599, statusText: "Provider Network Failure" });
  } finally {
    clearTimeout(timeout);
  }
}

'''

for target in TARGETS:
    p = Path(target)
    s = p.read_text(encoding='utf-8-sig')

    if 'async function boundedProviderFetch(' not in s:
        # Insert after imports and before the first runtime constant/type declaration.
        marker_candidates = ['const corsHeaders =', 'type ', 'interface ']
        positions = [s.find(marker) for marker in marker_candidates if s.find(marker) >= 0]
        if not positions:
            raise SystemExit(f'{target}: no safe helper insertion marker found.')
        pos = min(positions)
        s = s[:pos] + HELPER + s[pos:]

    # Route every awaited network request through the bounded primitive. Existing helper
    # functions (timedFetch/fetchText/etc.) may delegate to it; that is intentional.
    s = s.replace('await fetch(', 'await boundedProviderFetch(')

    # Restore only the raw fetch inside boundedProviderFetch itself.
    helper_start = s.find('async function boundedProviderFetch(')
    helper_end = s.find('\n}\n', helper_start)
    if helper_start < 0 or helper_end < 0:
        raise SystemExit(f'{target}: bounded helper could not be located after insertion.')
    helper_chunk = s[helper_start:helper_end + 3]
    helper_chunk = helper_chunk.replace('await boundedProviderFetch(input, { ...init, signal: controller.signal });',
                                        'await fetch(input, { ...init, signal: controller.signal });', 1)
    s = s[:helper_start] + helper_chunk + s[helper_end + 3:]

    raw_count = s.count('await fetch(')
    if raw_count != 1:
        raise SystemExit(f'{target}: expected helper-only raw awaited fetch count 1, found {raw_count}.')
    if 'status: 599' not in s or 'AbortController' not in s:
        raise SystemExit(f'{target}: bounded provider fallback is incomplete.')

    p.write_text(s)

print(f'Bounded provider networking installed across {len(TARGETS)} remaining Edge functions.')
