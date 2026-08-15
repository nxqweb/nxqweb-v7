import fs from "node:fs";

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Missing expected source shape: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`Expected one source match for: ${label}`);
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function update(path, transform) {
  const before = fs.readFileSync(path, "utf8");
  const after = transform(before);
  if (after === before) throw new Error(`No changes produced for ${path}`);
  fs.writeFileSync(path, after);
}

update("supabase/functions/scan-client-file/index.ts", (source) => {
  source = replaceOnce(
    source,
    'import { createClient } from "npm:@supabase/supabase-js@2";\n',
    'import { createClient } from "npm:@supabase/supabase-js@2";\nimport { requirePublicHttpsUrl } from "../_shared/outbound-security.ts";\n',
    "file scanner outbound guard import",
  );
  source = replaceOnce(
    source,
    '  if (!endpoint || !token) throw new Error("Malware scanner adapter is not configured.");\n\n  const controller = new AbortController();',
    '  if (!endpoint || !token) throw new Error("Malware scanner adapter is not configured.");\n  const safeEndpoint = requirePublicHttpsUrl(endpoint, "Malware scanner adapter URL");\n\n  const controller = new AbortController();',
    "file scanner adapter URL validation",
  );
  source = replaceOnce(
    source,
    '    const res = await fetch(endpoint, {\n      method: "POST",',
    '    const res = await fetch(safeEndpoint.toString(), {\n      method: "POST",\n      redirect: "error",',
    "file scanner redirect refusal",
  );
  source = replaceOnce(
    source,
    '    const maxBytes = Number(Deno.env.get("NXQ_FILE_SCAN_MAX_BYTES") || 25 * 1024 * 1024);\n    if (file.file_size != null && file.file_size > maxBytes) {',
    '    const maxBytes = Number(Deno.env.get("NXQ_FILE_SCAN_MAX_BYTES") || 25 * 1024 * 1024);\n    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > 100 * 1024 * 1024) {\n      throw new Error("NXQ_FILE_SCAN_MAX_BYTES must be a positive integer no larger than 100 MiB.");\n    }\n    if (file.file_size != null && file.file_size > maxBytes) {',
    "file scanner configured size validation",
  );
  return source;
});

update("supabase/functions/dispatch-notifications/index.ts", (source) => {
  source = replaceOnce(
    source,
    'import { createClient } from "npm:@supabase/supabase-js@2";\n',
    'import { createClient } from "npm:@supabase/supabase-js@2";\nimport { requirePublicHttpsUrl } from "../_shared/outbound-security.ts";\n',
    "notification outbound guard import",
  );
  source = replaceOnce(
    source,
    '  if (!endpoint || !token) throw new Error("Notification provider adapter is not configured.");\n  const idempotencyKey = delivery.id;',
    '  if (!endpoint || !token) throw new Error("Notification provider adapter is not configured.");\n  const safeEndpoint = requirePublicHttpsUrl(endpoint, "Notification adapter URL");\n  const idempotencyKey = delivery.id;',
    "notification adapter URL validation",
  );
  source = replaceOnce(
    source,
    '    const res = await fetch(endpoint, {\n      method: "POST",',
    '    const res = await fetch(safeEndpoint.toString(), {\n      method: "POST",\n      redirect: "error",',
    "notification adapter redirect refusal",
  );
  return source;
});

update("supabase/functions/run-website-maintenance/index.ts", (source) => {
  source = replaceOnce(
    source,
    'import type { DynamicDatabase } from "../_shared/dynamic-database.ts";\n',
    'import type { DynamicDatabase } from "../_shared/dynamic-database.ts";\nimport { normalizeGithubPrivateKey } from "../_shared/github-private-key.ts";\nimport { requirePublicHttpsUrl, validatedRedirectTarget } from "../_shared/outbound-security.ts";\n',
    "maintenance security imports",
  );
  const oldTimedFetch = `async function timedFetch(input: string, init: RequestInit = {}, timeoutMs = 12000) {\n  const controller = new AbortController();\n  const timeout = setTimeout(() => controller.abort(), timeoutMs);\n  const started = performance.now();\n  try {\n    const res = await fetch(input, { ...init, redirect: "follow", signal: controller.signal });\n    return { res, durationMs: Math.round(performance.now() - started) };\n  } catch (error) {\n    if (error instanceof DOMException && error.name === "AbortError") {\n      throw new Error(\`Maintenance HTTP request timed out after \${Math.round(timeoutMs / 1000)} seconds.\`, { cause: error });\n    }\n    throw error;\n  } finally {\n    clearTimeout(timeout);\n  }\n}\n`;
  const newTimedFetch = `async function timedFetch(input: string, init: RequestInit = {}, timeoutMs = 12000) {\n  const controller = new AbortController();\n  const timeout = setTimeout(() => controller.abort(), timeoutMs);\n  const started = performance.now();\n  let currentUrl = requirePublicHttpsUrl(input, "Maintenance URL");\n  let requestInit: RequestInit = { ...init };\n  try {\n    for (let redirects = 0; redirects <= 5; redirects += 1) {\n      const res = await fetch(currentUrl.toString(), { ...requestInit, redirect: "manual", signal: controller.signal });\n      if (![301, 302, 303, 307, 308].includes(res.status)) {\n        return { res, durationMs: Math.round(performance.now() - started) };\n      }\n      const location = res.headers.get("location");\n      if (!location) throw new Error("Maintenance redirect did not include a Location header.");\n      if (redirects === 5) throw new Error("Maintenance request exceeded the redirect limit.");\n      currentUrl = validatedRedirectTarget(location, currentUrl, "Maintenance redirect target");\n      if (res.status === 303 || ((res.status === 301 || res.status === 302) && String(requestInit.method || "GET").toUpperCase() === "POST")) {\n        requestInit = { ...requestInit, method: "GET", body: undefined };\n      }\n    }\n    throw new Error("Maintenance request exceeded the redirect limit.");\n  } catch (error) {\n    if (error instanceof DOMException && error.name === "AbortError") {\n      throw new Error(\`Maintenance HTTP request timed out after \${Math.round(timeoutMs / 1000)} seconds.\`, { cause: error });\n    }\n    throw error;\n  } finally {\n    clearTimeout(timeout);\n  }\n}\n`;
  source = replaceOnce(source, oldTimedFetch, newTimedFetch, "maintenance redirect-safe fetch");
  const oldUrlGuard = `function requireHttpsUrl(value: string) {\n  let url: URL;\n  try { url = new URL(value); } catch { throw new Error("Maintenance URL is invalid."); }\n  if (url.protocol !== "https:") throw new Error("Maintenance requires an HTTPS monitored URL.");\n  return url;\n}\n`;
  source = replaceOnce(
    source,
    oldUrlGuard,
    `function requireHttpsUrl(value: string) {\n  return requirePublicHttpsUrl(value, "Maintenance URL");\n}\n`,
    "maintenance URL guard",
  );
  source = replaceOnce(
    source,
    '  const privateKey = await importPKCS8(requiredSecret("GITHUB_APP_PRIVATE_KEY").replace(/\\\\n/g, "\\n"), "RS256");',
    '  const privateKey = await importPKCS8(normalizeGithubPrivateKey(requiredSecret("GITHUB_APP_PRIVATE_KEY")), "RS256");',
    "maintenance GitHub private key normalization",
  );
  return source;
});

console.log("Applied outbound security hardening to file scanning, notifications, and maintenance.");
