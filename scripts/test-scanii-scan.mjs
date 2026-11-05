// Offline tests for the Scanii helpers and the adapter's provider choice. No network, no secrets.
import fs from "node:fs";
import { SCANII_BASE_URLS, buildScaniiRequest, interpretScaniiResponse, scaniiAuthorization, scaniiBaseUrl } from "../supabase/functions/_shared/scanii-scan.ts";

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`PASS  ${name}`);
  else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); }
}

// ---- region allowlist ----
check("default region is us1", scaniiBaseUrl(undefined) === "https://api-us1.scanii.com" && scaniiBaseUrl("") === "https://api-us1.scanii.com");
check("every documented region resolves to a fixed scanii.com host", Object.values(SCANII_BASE_URLS).every((url) => /^https:\/\/api-[a-z0-9]+\.scanii\.com$/.test(url)) && Object.keys(SCANII_BASE_URLS).length === 6);
check("region match ignores case and spaces", scaniiBaseUrl(" EU1 ") === "https://api-eu1.scanii.com");
check("unknown regions and prototype names are rejected, never guessed", ["evil", "us1.evil.com", "__proto__", "constructor", "toString", "https://x.com"].every((region) => scaniiBaseUrl(region) === null));

// ---- request ----
check("authorization is HTTP Basic key:secret", scaniiAuthorization("KEY", "SECRET") === `Basic ${Buffer.from("KEY:SECRET").toString("base64")}`);
const bytes = new TextEncoder().encode("hello world!").buffer;
const request = buildScaniiRequest({ baseUrl: "https://api-us1.scanii.com", apiKey: "KEY", apiSecret: "SECRET", bytes, contentType: "text/plain", clientFileId: "11111111-2222-3333-4444-555555555555" });
check("request targets the v2.2 files endpoint with POST and no redirects", request.url === "https://api-us1.scanii.com/v2.2/files" && request.init.method === "POST" && request.init.redirect === "error");
check("request carries the Basic header and nothing secret in the body", request.init.headers.Authorization.startsWith("Basic ") && request.init.body instanceof FormData && ![...request.init.body.values()].some((value) => typeof value === "string" && /SECRET|KEY/.test(value)));
const sentFile = request.init.body.get("file");
check("the real client file name is never sent; a neutral name is used", sentFile instanceof File && sentFile.name === "upload.bin" && sentFile.size === 12);
check("only the client file id is attached as metadata", request.init.body.get("metadata[client_file_id]") === "11111111-2222-3333-4444-555555555555");

// ---- responses ----
const cleanBody = JSON.stringify({ id: "fb7b800970fdaaac1a87d2b39bb5fb14", checksum: "22596363b3de40b06f981fb85d82312e8c0ed511", content_length: 12, findings: [], creation_date: "2020-09-21T11:52:31.600929Z", content_type: "text/plain", metadata: {} });
const clean = interpretScaniiResponse(201, cleanBody, 12);
check("documented clean sample is clean", clean.ok && clean.clean === true && clean.findings.length === 0 && clean.providerId === "fb7b800970fdaaac1a87d2b39bb5fb14");
const infected = interpretScaniiResponse(201, JSON.stringify({ id: "x1", content_length: 1579562, findings: ["av.win.trojan.agent-948155"] }), 1579562);
check("documented infected sample is infected with the finding named", infected.ok && infected.clean === false && infected.findings[0] === "av.win.trojan.agent-948155");
check("a different processed size fails closed", interpretScaniiResponse(201, cleanBody, 13).ok === false);
check("missing content_length fails closed", interpretScaniiResponse(201, JSON.stringify({ id: "x", findings: [] }), 12).ok === false);
check("missing findings evidence fails closed (never clean)", interpretScaniiResponse(201, JSON.stringify({ id: "x", content_length: 12 }), 12).ok === false);
check("findings that is not a list fails closed", interpretScaniiResponse(201, JSON.stringify({ id: "x", content_length: 12, findings: "clean" }), 12).ok === false);
check("unreadable findings entries fail closed instead of reading as clean", interpretScaniiResponse(201, JSON.stringify({ id: "x", content_length: 12, findings: [1, null, {}] }), 12).ok === false);
check("missing result id fails closed", interpretScaniiResponse(201, JSON.stringify({ content_length: 12, findings: [] }), 12).ok === false);
check("non-201 statuses fail closed", [200, 202, 400, 401, 403, 404, 500, 503].every((status) => { const v = interpretScaniiResponse(status, cleanBody, 12); return v.ok === false && v.httpStatus === 502; }));
check("429 maps to a rate-limit result", (() => { const v = interpretScaniiResponse(429, "", 12); return v.ok === false && v.httpStatus === 429; })());
check("invalid JSON, null, arrays and empty bodies fail closed", ["not json", "null", "[]", ""].every((text) => interpretScaniiResponse(201, text, 12).ok === false));
check("oversized responses fail closed", interpretScaniiResponse(201, JSON.stringify({ id: "x", content_length: 12, findings: [], pad: "a".repeat(70_000) }), 12).ok === false);
const many = interpretScaniiResponse(201, JSON.stringify({ id: "x", content_length: 12, findings: Array.from({ length: 30 }, (_, i) => `f${i}-${"z".repeat(300)}`) }), 12);
check("findings are capped at 20 entries of 240 characters", many.ok && many.findings.length === 20 && many.findings.every((f) => f.length === 240) && many.clean === false);
check("error reasons never contain the response body or secrets", ["secret-token-123"].every((leak) => !JSON.stringify(interpretScaniiResponse(500, `{"error":"${leak}"}`, 12)).includes(leak)));

// ---- adapter wiring (static) ----
const adapter = fs.readFileSync("supabase/functions/malware-scan-provider-adapter/index.ts", "utf8");
check("adapter picks Scanii when both secrets are set, else Cloudmersive, and can be forced", adapter.includes("NXQ_SCANII_API_KEY") && adapter.includes("NXQ_SCANII_API_SECRET") && adapter.includes("NXQ_MALWARE_PROVIDER") && adapter.includes('scaniiReady ? "scanii" : cloudmersiveApiKey ? "cloudmersive" : ""'));
check("no configured provider fails closed with 503", adapter.includes("No malware scan provider is configured.") && adapter.includes("}, 503);"));
check("Scanii calls go only to the allowlisted host and never follow redirects", adapter.includes("scaniiBaseUrl(environmentSecret(\"NXQ_SCANII_REGION\"))") && adapter.includes("buildScaniiRequest(") && request.init.redirect === "error");
check("Cloudmersive path is unchanged", adapter.includes('fetch("https://api.cloudmersive.com/virus/scan/file"') && adapter.includes('typeof providerBody.CleanResult !== "boolean"'));
check("results are labeled with the real provider", adapter.includes("provider_reference: `scanii:${observedSha256}`") && adapter.includes('provider: "scanii"'));
check("adapter never logs or returns secret values", !/console\.(log|error)\([^)]*(Secret|ApiKey)/.test(adapter) && adapter.includes("secret_values_returned: false"));

console.log(failures ? `\n${failures} Scanii check(s) FAILED.` : "\nAll Scanii checks passed.");
process.exit(failures ? 1 : 0);
