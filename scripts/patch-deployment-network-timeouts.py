from pathlib import Path

TARGETS = [
    'supabase/functions/execute-preview-netlify-build/index.ts',
    'supabase/functions/execute-production-netlify-build/index.ts',
    'supabase/functions/check-preview-netlify-status/index.ts',
    'supabase/functions/check-production-netlify-status/index.ts',
    'supabase/functions/publish-production-netlify-deploy/index.ts',
]

HELPER = r'''async function boundedProviderFetch(input: string, init: RequestInit = {}, timeoutMs = 15_000) {
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
    s = p.read_text()
    if 'async function boundedProviderFetch(' not in s:
        marker = 'function jsonResponse(body: unknown, status = 200) {'
        start = s.find(marker)
        if start < 0:
            raise SystemExit(f'{target}: jsonResponse marker missing; refusing ambiguous patch.')
        # Insert before jsonResponse so all provider calls below can use it.
        s = s[:start] + HELPER + s[start:]

    # Replace every awaited raw provider/network call in this file. The helper itself was
    # inserted after this replacement target is computed, so explicitly restore its raw fetch.
    s = s.replace('await fetch(', 'await boundedProviderFetch(')
    s = s.replace('return await boundedProviderFetch(input, { ...init, signal: controller.signal });',
                  'return await fetch(input, { ...init, signal: controller.signal });', 1)

    # The only raw fetch left must be the helper implementation itself.
    raw_count = s.count('await fetch(')
    if raw_count != 1:
        raise SystemExit(f'{target}: expected exactly one raw fetch inside boundedProviderFetch, found {raw_count}.')
    if 'status: 599' not in s or 'AbortController' not in s:
        raise SystemExit(f'{target}: bounded provider failure response was not installed.')
    p.write_text(s)

print(f'Bounded provider/network requests installed across {len(TARGETS)} deployment functions.')
