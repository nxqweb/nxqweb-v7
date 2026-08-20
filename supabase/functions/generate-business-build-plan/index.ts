import { createClient } from "npm:@supabase/supabase-js@2";

type JsonRecord = Record<string, unknown>;
type ProviderProtocol = "openai_responses" | "openai_chat_completions";
type BuildPlanRequest = {
  task: "enrich_business_build_plan_v1";
  schema_version: "nxq-business-build-plan-v1";
  request_fingerprint: string;
  input: {
    business_name: string;
    business_type: string;
    service_area: string;
    services: string[];
    goals: string;
    desired_style: string;
    approved_pages: string[];
    product_tier_key: string;
  };
  contract: {
    plain_text_only: true;
    no_links_or_markup: true;
    allowed_services: string[];
    allowed_pages: string[];
    allowed_theme_keys: string[];
    minimum_confidence: number;
    production_or_provider_actions_forbidden: true;
    legal_financial_medical_guarantees_forbidden: true;
  };
};

const workerName = "generate-business-build-plan";
const workerVersion = "v1-structured-runtime";
const schemaVersion = "nxq-business-build-plan-v1";
const allowedInputKeys = new Set([
  "business_name",
  "business_type",
  "service_area",
  "services",
  "goals",
  "desired_style",
  "approved_pages",
  "product_tier_key",
]);
const allowedThemeKeys = new Set(["midnight_blue", "charcoal_gold", "forest_emerald", "royal_violet"]);
const responseHeaders = { "Content-Type": "application/json" };

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

function requiredSecret(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing protected secret: ${name}`);
  return value;
}

function optionalSecret(name: string) {
  return Deno.env.get(name)?.trim() || "";
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function text(value: unknown, label: string, min: number, max: number) {
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length < min || normalized.length > max) {
    throw new Error(`${label} must be between ${min} and ${max} characters.`);
  }
  return normalized;
}

function textList(value: unknown, label: string, minItems: number, maxItems: number, itemMax: number) {
  if (!Array.isArray(value) || value.length < minItems || value.length > maxItems) {
    throw new Error(`${label} must contain ${minItems}-${maxItems} items.`);
  }
  const normalized = value.map((item, index) => text(item, `${label}[${index}]`, 2, itemMax));
  if (new Set(normalized.map((item) => item.toLowerCase())).size !== normalized.length) {
    throw new Error(`${label} cannot contain duplicate items.`);
  }
  return normalized;
}

function sameStrings(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validatePublicHttpsUrl(rawUrl: string, label: string) {
  let url: URL;
  try { url = new URL(rawUrl); }
  catch { throw new Error(`${label} must be a valid URL.`); }
  const host = url.hostname.toLowerCase();
  const privateIpv4 = /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
  const privateIpv6 = host === "::1" || host === "[::1]" || /^\[(?:fc|fd|fe[89ab])/i.test(host);
  if (url.protocol !== "https:" || url.username || url.password || host === "localhost" || privateIpv4 || privateIpv6) {
    throw new Error(`${label} must be a credential-free public HTTPS endpoint.`);
  }
  return url.toString();
}

async function constantTimeEqual(left: string, right: string) {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < leftBytes.length; index += 1) difference |= leftBytes[index] ^ rightBytes[index];
  return difference === 0;
}

function validateRequest(value: unknown): BuildPlanRequest {
  const root = record(value);
  if (root.task !== "enrich_business_build_plan_v1" || root.schema_version !== schemaVersion) {
    throw new Error("Unsupported NXQ AI task or schema version.");
  }
  const requestFingerprint = text(root.request_fingerprint, "request_fingerprint", 64, 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(requestFingerprint)) throw new Error("request_fingerprint must be a SHA-256 hex digest.");

  const rawInput = record(root.input);
  const unexpectedInputKey = Object.keys(rawInput).find((key) => !allowedInputKeys.has(key));
  if (unexpectedInputKey) throw new Error(`AI input contains unsupported field ${unexpectedInputKey}.`);
  const services = textList(rawInput.services, "input.services", 1, 8, 120);
  const approvedPages = textList(rawInput.approved_pages, "input.approved_pages", 4, 8, 80);
  const input = {
    business_name: text(rawInput.business_name, "input.business_name", 2, 160),
    business_type: text(rawInput.business_type, "input.business_type", 2, 160),
    service_area: typeof rawInput.service_area === "string" ? rawInput.service_area.replace(/\s+/g, " ").trim().slice(0, 500) : "",
    services,
    goals: text(rawInput.goals, "input.goals", 10, 2500),
    desired_style: text(rawInput.desired_style, "input.desired_style", 5, 1800),
    approved_pages: approvedPages,
    product_tier_key: text(rawInput.product_tier_key, "input.product_tier_key", 2, 80),
  };

  const rawContract = record(root.contract);
  const contractServices = textList(rawContract.allowed_services, "contract.allowed_services", 1, 8, 120);
  const contractPages = textList(rawContract.allowed_pages, "contract.allowed_pages", 4, 8, 80);
  const contractThemes = textList(rawContract.allowed_theme_keys, "contract.allowed_theme_keys", 1, 4, 80);
  if (!sameStrings(services, contractServices) || !sameStrings(approvedPages, contractPages)) {
    throw new Error("AI contract allowlists do not match the sanitized intake.");
  }
  if (contractThemes.some((theme) => !allowedThemeKeys.has(theme))) {
    throw new Error("AI contract requested a theme outside the NXQ allowlist.");
  }
  const minimumConfidence = Number(rawContract.minimum_confidence);
  if (!Number.isFinite(minimumConfidence) || minimumConfidence < 0.82 || minimumConfidence > 1) {
    throw new Error("AI contract minimum confidence is outside NXQ safety limits.");
  }
  if (rawContract.plain_text_only !== true || rawContract.no_links_or_markup !== true
    || rawContract.production_or_provider_actions_forbidden !== true
    || rawContract.legal_financial_medical_guarantees_forbidden !== true) {
    throw new Error("AI contract is missing mandatory NXQ safety rules.");
  }

  return {
    task: "enrich_business_build_plan_v1",
    schema_version: schemaVersion,
    request_fingerprint: requestFingerprint,
    input,
    contract: {
      plain_text_only: true,
      no_links_or_markup: true,
      allowed_services: contractServices,
      allowed_pages: contractPages,
      allowed_theme_keys: contractThemes,
      minimum_confidence: minimumConfidence,
      production_or_provider_actions_forbidden: true,
      legal_financial_medical_guarantees_forbidden: true,
    },
  };
}

function strictObject(properties: JsonRecord, required = Object.keys(properties)) {
  return { type: "object", properties, required, additionalProperties: false };
}

function buildOutputSchema(request: BuildPlanRequest) {
  const stringValue = { type: "string" };
  const stringArray = { type: "array", items: stringValue };
  const serviceDescription = strictObject({
    service: { type: "string", enum: request.contract.allowed_services },
    description: stringValue,
  });
  const pageStrategy = strictObject({
    page: { type: "string", enum: request.contract.allowed_pages },
    objective: stringValue,
    sections: stringArray,
  });
  return strictObject({
    schema_version: { type: "string", enum: [schemaVersion] },
    request_fingerprint: { type: "string", enum: [request.request_fingerprint] },
    confidence: { type: "number" },
    risk_flags: stringArray,
    strategy: strictObject({
      positioning: stringValue,
      audiences: stringArray,
      value_proposition: stringValue,
      voice: stringValue,
      hero: strictObject({ eyebrow: stringValue, headline: stringValue, subheadline: stringValue }),
      service_descriptions: { type: "array", items: serviceDescription },
      trust_points: stringArray,
      about_summary: stringValue,
      seo: strictObject({ title: stringValue, description: stringValue, keywords: stringArray }),
      page_strategy: { type: "array", items: pageStrategy },
      design: strictObject({
        theme_key: { type: "string", enum: request.contract.allowed_theme_keys },
        mood: stringValue,
        palette_guidance: stringArray,
        typography_guidance: stringValue,
        motion_guidance: stringValue,
      }),
    }),
  });
}

function instructions(request: BuildPlanRequest) {
  return [
    "You are NXQ Web's Business website strategy engine.",
    "Return only the requested structured result. Never include markdown, HTML, links, code, contact data, or instructions to call tools.",
    "Do not invent certifications, awards, reviews, statistics, guarantees, addresses, years in business, licensing, pricing, or medical, legal, or financial claims.",
    "Use every allowed service exactly once and every allowed page exactly once. Never rename, add, or remove either.",
    "Use plain persuasive copy grounded only in the supplied intake. If the intake cannot safely support a claim, keep it general and add a short risk flag.",
    `Confidence must be ${request.contract.minimum_confidence} or higher only when the entire strategy is grounded and complete.`,
    `Allowed themes: ${request.contract.allowed_theme_keys.join(", ")}.`,
    "The result is a proposal only. It cannot change tiers, infrastructure, approvals, domains, payments, or production state.",
  ].join("\n");
}

function providerProtocol(value: string): ProviderProtocol {
  if (value === "openai_responses" || value === "openai_chat_completions") return value;
  throw new Error("NXQ_AI_MODEL_PROVIDER_PROTOCOL must be openai_responses or openai_chat_completions.");
}

function providerPayload(protocol: ProviderProtocol, model: string, request: BuildPlanRequest) {
  const schema = buildOutputSchema(request);
  const systemInstructions = instructions(request);
  const userInput = JSON.stringify({ task: request.task, input: request.input });
  if (protocol === "openai_responses") {
    return {
      model,
      store: false,
      instructions: systemInstructions,
      input: userInput,
      text: { format: { type: "json_schema", name: "nxq_business_build_plan", strict: true, schema } },
      max_output_tokens: 5_000,
    };
  }
  return {
    model,
    messages: [
      { role: "system", content: systemInstructions },
      { role: "user", content: userInput },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "nxq_business_build_plan", strict: true, schema },
    },
    max_completion_tokens: 5_000,
  };
}

function responsesOutput(root: JsonRecord) {
  if (root.status !== "completed") {
    const reason = record(root.incomplete_details).reason;
    throw new Error(`AI provider response was incomplete${reason ? `: ${String(reason).slice(0, 80)}` : "."}`);
  }
  if (typeof root.output_text === "string" && root.output_text.trim()) return root.output_text.trim();
  const outputs = Array.isArray(root.output) ? root.output : [];
  const pieces: string[] = [];
  for (const output of outputs) {
    const content = Array.isArray(record(output).content) ? record(output).content as unknown[] : [];
    for (const item of content) {
      const part = record(item);
      if (part.type === "refusal" || typeof part.refusal === "string") throw new Error("AI provider refused the build-plan request.");
      if (part.type === "output_text" && typeof part.text === "string") pieces.push(part.text);
    }
  }
  if (pieces.length === 0) throw new Error("AI provider completed without structured output.");
  return pieces.join("").trim();
}

function chatOutput(root: JsonRecord) {
  const choices = Array.isArray(root.choices) ? root.choices : [];
  const choice = record(choices[0]);
  if (choice.finish_reason !== "stop") throw new Error(`AI provider did not finish cleanly (${String(choice.finish_reason || "unknown")}).`);
  const message = record(choice.message);
  if (typeof message.refusal === "string" && message.refusal.trim()) throw new Error("AI provider refused the build-plan request.");
  if (typeof message.content !== "string" || !message.content.trim()) throw new Error("AI provider completed without structured output.");
  return message.content.trim();
}

function validateProviderResult(value: unknown, request: BuildPlanRequest) {
  const root = record(value);
  const keys = Object.keys(root).sort().join(",");
  if (keys !== "confidence,request_fingerprint,risk_flags,schema_version,strategy") {
    throw new Error("AI provider result has an unexpected top-level shape.");
  }
  if (root.schema_version !== schemaVersion || root.request_fingerprint !== request.request_fingerprint) {
    throw new Error("AI provider result did not preserve the NXQ schema and intake fingerprint.");
  }
  if (!Number.isFinite(Number(root.confidence)) || !Array.isArray(root.risk_flags) || !root.strategy) {
    throw new Error("AI provider result is missing required safety fields.");
  }
  return root;
}

async function recordHeartbeat(admin: unknown, status: "healthy" | "degraded" | "error", metadata: JsonRecord, error: string | null) {
  const rpcClient = admin as {
    rpc: (functionName: string, args: JsonRecord) => PromiseLike<unknown>;
  };
  await rpcClient.rpc("record_worker_heartbeat", {
    target_worker_key: workerName,
    target_execution_target: "ai",
    target_status: status,
    target_metadata: { worker_version: workerVersion, ...metadata },
    target_last_error: error,
  });
}

function stagingFallback(request: BuildPlanRequest) {
  const n = request.input.business_name;
  const t = request.input.business_type;
  const a = request.input.service_area;
  const services = request.contract.allowed_services;
  const pages = request.contract.allowed_pages;
  const style = request.input.desired_style.toLowerCase();
  const theme = style.includes("gold") ? "charcoal_gold"
    : style.includes("green") ? "forest_emerald"
    : style.includes("purple") || style.includes("violet") ? "royal_violet"
    : "midnight_blue";
  const clip = (value: string, max: number) => {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (normalized.length <= max) return normalized;
    const candidate = normalized.slice(0, max + 1);
    const boundary = candidate.lastIndexOf(" ");
    const clipped = boundary >= Math.floor(max * 0.7)
      ? candidate.slice(0, boundary)
      : normalized.slice(0, max);
    return clipped.replace(/[-,:;/]+$/g, "").trim();
  };
  const shortType = clip(t, 48) || "local service";
  const shortName = clip(n, 52) || "Local Business";
  const areaText = a ? ` across ${clip(a, 102)}` : " in the local service area";

  return {
    schema_version: schemaVersion,
    request_fingerprint: request.request_fingerprint,
    confidence: 0.9,
    risk_flags: [],
    strategy: {
      positioning: clip(`${shortName} is positioned as a dependable professional ${shortType} provider focused on clear service information, responsive communication, and qualified local leads.`, 300),
      audiences: ["Local property owners", "Commercial property managers", "Customers needing prompt service"],
      value_proposition: clip(`${shortName} presents its approved services with a clear path to request help, emphasizing professional execution, responsive communication, and a polished customer experience.`, 320),
      voice: "Professional, confident, direct, trustworthy, and helpful without exaggerated claims.",
      hero: {
        eyebrow: clip(`${shortName} Professional Service`, 80),
        headline: clip(`${shortName} Professional Service You Can Reach Fast`, 110),
        subheadline: clip(`${shortName} makes it simple to understand available services, request a quote, and reach the team when timely professional help matters.`, 260),
      },
      service_descriptions: services.map((service) => ({
        service,
        description: clip(`${shortName} provides ${service} with a professional, safety-minded approach, clear communication, and an easy path for customers to request service.`, 280),
      })),
      trust_points: [
        "Clear and responsive customer communication",
        "Professional service planning and execution",
        "Simple quote and contact pathways",
      ],
      about_summary: clip(`${shortName} serves customers looking for dependable ${shortType} support${areaText}. The website should communicate services clearly, make inquiries easy to route, and reinforce a professional customer experience without unsupported claims.`, 600),
      seo: {
        title: clip(`${shortName} Professional Local Service`, 60),
        description: clip(`${shortName} provides professional ${shortType} service with clear information, responsive contact options, and an easy quote request process.`, 160),
        keywords: [shortType, ...services.slice(0, 4), "local professional service"].map((value) => clip(value, 80)).slice(0, 10),
      },
      page_strategy: pages.map((page) => ({
        page,
        objective: clip(`Give the ${page} page a focused customer objective grounded only in the approved intake and guide visitors toward the right next step.`, 240),
        sections: ["Page introduction", "Primary page content", "Supporting trust content", "Contact call to action"],
      })),
      design: {
        theme_key: request.contract.allowed_theme_keys.includes(theme) ? theme : request.contract.allowed_theme_keys[0],
        mood: "Premium, modern, polished, confident, high-contrast, and appropriate for a professional local-service business.",
        palette_guidance: ["Use a dark premium foundation", "Keep accent contrast strong and restrained", "Preserve excellent text readability"],
        typography_guidance: "Use large confident headings, readable body type, and a disciplined hierarchy that feels premium rather than flashy.",
        motion_guidance: "Use subtle purposeful transitions and restrained motion that supports clarity without distracting from calls to action.",
      },
    },
  };
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return response({ ok: false, error: "POST required." }, 405);
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > 64_000) return response({ ok: false, error: "Request body is too large." }, 413);

  const adapterToken = optionalSecret("NXQ_BUILD_PLAN_AI_ADAPTER_TOKEN");
  const authorization = request.headers.get("Authorization") || "";
  const suppliedToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!adapterToken || !suppliedToken || !(await constantTimeEqual(adapterToken, suppliedToken))) {
    return response({ ok: false, error: "Unauthorized." }, 401);
  }

  const admin = createClient(requiredSecret("SUPABASE_URL"), requiredSecret("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
  const providerUrlRaw = optionalSecret("NXQ_AI_MODEL_PROVIDER_URL");
  const providerToken = optionalSecret("NXQ_AI_MODEL_PROVIDER_TOKEN");
  const providerModel = optionalSecret("NXQ_AI_MODEL_PROVIDER_MODEL");
  const protocolRaw = optionalSecret("NXQ_AI_MODEL_PROVIDER_PROTOCOL") || "openai_responses";
  const providerConfigured = Boolean(providerUrlRaw && providerToken && providerModel);
  if (!providerConfigured) {
    const runtimeEnvironment = optionalSecret("NXQ_RUNTIME_ENVIRONMENT").toLowerCase();
    const stagingOnlyFallbackAllowed = new Set(["staging", "stage", "development", "dev", "test", "qa"]).has(runtimeEnvironment);
    if (stagingOnlyFallbackAllowed) {
      let fallbackRequest: BuildPlanRequest;
      try { fallbackRequest = validateRequest(await request.json()); }
      catch (error) {
        const message = error instanceof Error ? error.message : "Invalid build-plan request.";
        await recordHeartbeat(admin, "degraded", { provider_configured: false, staging_fallback: true }, message);
        return response({ ok: false, error: message }, 400);
      }
      const fallback = stagingFallback(fallbackRequest);
      await recordHeartbeat(admin, "healthy", { provider_configured: false, provider_call_proven: false, staging_fallback: true, schema_version: schemaVersion }, null);
      return response(fallback);
    }
    await recordHeartbeat(admin, "degraded", { provider_configured: false, provider_call_proven: false }, "AI model provider is not configured.");
    return response({ ok: false, configured: false, error: "AI model provider is not configured." }, 503);
  }

  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 64_000) throw new Error("Request body is too large.");
    body = raw ? JSON.parse(raw) : null;
  } catch (error) {
    return response({ ok: false, error: error instanceof Error ? error.message : "Invalid JSON request." }, 400);
  }

  let parsedRequest: BuildPlanRequest;
  try {
    parsedRequest = validateRequest(body);
  } catch (error) {
    return response({ ok: false, error: error instanceof Error ? error.message : "Invalid NXQ build-plan request." }, 400);
  }

  let protocol: ProviderProtocol;
  let providerUrl: string;
  try {
    protocol = providerProtocol(protocolRaw);
    providerUrl = validatePublicHttpsUrl(providerUrlRaw, "AI model provider URL");
    text(providerModel, "AI model provider model", 1, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI model provider configuration is invalid.";
    await recordHeartbeat(admin, "degraded", {
      provider_configured: false,
      provider_call_proven: false,
      schema_version: schemaVersion,
    }, message);
    return response({ ok: false, configured: false, error: message }, 503);
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    let providerResponse: Response;
    try {
      providerResponse = await fetch(providerUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${providerToken}` },
        body: JSON.stringify(providerPayload(protocol, providerModel, parsedRequest)),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    const providerText = await providerResponse.text();
    if (providerText.length > 256_000) throw new Error("AI provider response exceeded the 256 KB safety limit.");
    if (!providerResponse.ok) throw new Error(`AI provider request failed with HTTP ${providerResponse.status}.`);
    let providerBody: unknown;
    try { providerBody = providerText ? JSON.parse(providerText) : null; }
    catch { throw new Error("AI provider returned invalid JSON."); }
    const outputText = protocol === "openai_responses" ? responsesOutput(record(providerBody)) : chatOutput(record(providerBody));
    if (outputText.length > 64_000) throw new Error("AI structured output exceeded the 64 KB safety limit.");
    let structured: unknown;
    try { structured = JSON.parse(outputText); }
    catch { throw new Error("AI provider structured output was not valid JSON."); }
    const result = validateProviderResult(structured, parsedRequest);
    const now = new Date().toISOString();
    await recordHeartbeat(admin, "healthy", {
      provider_configured: true,
      provider_protocol: protocol,
      model_configured: true,
      schema_version: schemaVersion,
      task_supported: parsedRequest.task,
      provider_call_proven: true,
      last_request_fingerprint: parsedRequest.request_fingerprint,
      last_success_at: now,
    }, null);
    await admin.from("nxq_provider_connections").update({
      status: "healthy",
      last_checked_at: now,
      last_success_at: now,
      last_error: null,
      updated_at: now,
    }).eq("provider_key", "business_build_plan_ai").eq("scope_type", "global").is("scope_id", null);
    return response(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI build-plan runtime failed.";
    await recordHeartbeat(admin, "error", {
      provider_configured: true,
      provider_protocol: protocol,
      model_configured: true,
      schema_version: schemaVersion,
      task_supported: "enrich_business_build_plan_v1",
      provider_call_proven: false,
      request_fingerprint: parsedRequest.request_fingerprint,
      failed_at: new Date().toISOString(),
    }, message);
    await admin.from("nxq_provider_connections").update({
      status: "error",
      last_checked_at: new Date().toISOString(),
      last_error: message.slice(0, 500),
      updated_at: new Date().toISOString(),
    }).eq("provider_key", "business_build_plan_ai").eq("scope_type", "global").is("scope_id", null);
    return response({ ok: false, error: message }, 502);
  }
});
