import { createClient } from "npm:@supabase/supabase-js@2";
import { requirePublicHttpsUrl } from "../_shared/outbound-security.ts";

type Job = { id: string; client_id: string; project_id: string; job_type: string; payload?: Record<string, unknown> | null };
type JsonRecord = Record<string, unknown>;
type ProviderProtocol = "openai_responses" | "openai_chat_completions";
type ClassifierResult = { route: "safe_patch" | "needs_info" | "owner_review"; confidence: number; patch?: JsonRecord; question?: string; reason?: string };

const workerName = "classify-business-change-request";
const workerVersion = "v4-staging-owner-review-fallback";
const headers = { "Content-Type": "application/json" };
const supportedPatchKeys = new Set(["contact_phone", "contact_email", "service_area", "goals", "desired_style", "about", "add_services", "remove_services"]);

function secret(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing protected secret: ${name}`);
  return value;
}
function optionalSecret(name: string) { return Deno.env.get(name)?.trim() || ""; }
function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers }); }
function record(value: unknown): JsonRecord { return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {}; }
function cleanText(value: unknown, max: number) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
function normalize(value: unknown): Job | null {
  if (value == null) return null;
  let normalized = value;
  if (typeof normalized === "string") normalized = JSON.parse(normalized);
  if (Array.isArray(normalized)) normalized = normalized[0] ?? null;
  if (!normalized || typeof normalized !== "object") throw new Error("Invalid classifier job.");
  const job = normalized as Job;
  if (!job.id || !job.client_id || !job.project_id) throw new Error("Classifier job missing ids.");
  return job;
}

function validatePatch(value: unknown) {
  const patch = record(value);
  const keys = Object.keys(patch);
  if (keys.length === 0 || keys.some((key) => !supportedPatchKeys.has(key))) return null;
  const output: JsonRecord = {};
  for (const key of keys) {
    const raw = patch[key];
    if (key === "add_services" || key === "remove_services") {
      if (!Array.isArray(raw)) return null;
      const services = [...new Set(raw.map(String).map((item) => item.trim()).filter(Boolean))].slice(0, 12);
      if (!services.length) return null;
      output[key] = services;
    } else {
      const text = cleanText(raw, key === "goals" || key === "about" ? 2500 : key === "desired_style" ? 1800 : 500);
      if (!text) return null;
      if (key === "contact_email") {
        const email = text.toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 180) return null;
        output[key] = email;
      } else if (key === "contact_phone") {
        if (!/^[+()\-\s\d.]{7,32}$/.test(text)) return null;
        output[key] = text;
      } else output[key] = text;
    }
  }
  const additions = new Set(Array.isArray(output.add_services) ? output.add_services.map((item) => String(item).toLowerCase()) : []);
  const removals = Array.isArray(output.remove_services) ? output.remove_services.map((item) => String(item).toLowerCase()) : [];
  if (removals.some((service) => additions.has(service))) return null;
  return output;
}

function parseResult(value: unknown): ClassifierResult {
  const result = record(value);
  const keys = Object.keys(result).sort().join(",");
  if (keys !== "confidence,patch_json,question,reason,route") throw new Error("Classifier returned an unexpected result shape.");
  const route = String(result.route || "");
  if (!["safe_patch", "needs_info", "owner_review"].includes(route)) throw new Error("Classifier returned unsupported route.");
  const confidence = Number(result.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error("Classifier confidence must be between 0 and 1.");
  if (typeof result.patch_json !== "string" || result.patch_json.length > 12_000) throw new Error("Classifier patch_json is invalid.");
  let patch: unknown;
  try { patch = JSON.parse(result.patch_json); }
  catch { throw new Error("Classifier patch_json is not valid JSON."); }
  if (Object.keys(record(patch)).some((key) => !supportedPatchKeys.has(key))) throw new Error("Classifier patch_json contains an unsupported field.");
  return {
    route: route as ClassifierResult["route"],
    confidence,
    patch: record(patch),
    question: cleanText(result.question, 700),
    reason: cleanText(result.reason, 1200),
  };
}

function deterministicResult(requestedPayload: unknown): ClassifierResult | null {
  const patch = record(record(requestedPayload).patch);
  const keys = Object.keys(patch);
  if (keys.length === 0 || keys.some((key) => key !== "contact_email" && key !== "contact_phone")) return null;
  const normalized: JsonRecord = {};
  if ("contact_email" in patch) {
    const email = cleanText(patch.contact_email, 180).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
    normalized.contact_email = email;
  }
  if ("contact_phone" in patch) {
    const phone = cleanText(patch.contact_phone, 80);
    if (!/^[+()\-\s\d.]{7,32}$/.test(phone)) return null;
    normalized.contact_phone = phone;
  }
  return { route: "safe_patch", confidence: 0.99, patch: normalized, reason: "A validated contact-only structured patch can use deterministic routing." };
}

function providerProtocol(value: string): ProviderProtocol {
  if (value === "openai_responses" || value === "openai_chat_completions") return value;
  throw new Error("NXQ_AI_MODEL_PROVIDER_PROTOCOL must be openai_responses or openai_chat_completions.");
}

function classificationSchema() {
  return {
    type: "object",
    properties: {
      route: { type: "string", enum: ["safe_patch", "needs_info", "owner_review"] },
      confidence: { type: "number" },
      patch_json: { type: "string" },
      question: { type: "string" },
      reason: { type: "string" },
    },
    required: ["route", "confidence", "patch_json", "question", "reason"],
    additionalProperties: false,
  };
}

function providerInstructions() {
  return [
    "You are NXQ-Web's conservative website-change classifier.",
    "Return only the requested structured result. Never include markdown, links, code, tool calls, or secrets.",
    `Allowed patch keys: ${[...supportedPatchKeys].join(", ")}.`,
    "Use safe_patch only when the whole request is a low-risk, reversible content update, patch_json is a JSON object containing only allowed keys, and confidence is at least 0.90.",
    "Use needs_info when required details are missing or ambiguous. Put one concise question in question and set patch_json to {}.",
    "Use owner_review for legal, financial, medical, guarantee, pricing, payment, tier, provider, infrastructure, domain, approval, or production changes. Set patch_json to {}.",
    "Never invent facts, claims, contact data, services, or business details. Use empty strings for question or reason when they do not apply.",
  ].join("\n");
}

function providerPayload(protocol: ProviderProtocol, model: string, input: JsonRecord) {
  const schema = classificationSchema();
  const userInput = JSON.stringify({ task: "classify_business_change_request_v3", input });
  if (userInput.length > 64_000) throw new Error("AI classifier input exceeded the 64 KB safety limit.");
  if (protocol === "openai_responses") {
    return {
      model,
      store: false,
      instructions: providerInstructions(),
      input: userInput,
      text: { format: { type: "json_schema", name: "nxq_business_change_classification", strict: true, schema } },
      max_output_tokens: 1_500,
    };
  }
  return {
    model,
    messages: [
      { role: "system", content: providerInstructions() },
      { role: "user", content: userInput },
    ],
    response_format: { type: "json_schema", json_schema: { name: "nxq_business_change_classification", strict: true, schema } },
    max_completion_tokens: 1_500,
  };
}

function responsesOutput(root: JsonRecord) {
  if (root.status !== "completed") throw new Error("AI provider response was incomplete.");
  if (typeof root.output_text === "string" && root.output_text.trim()) return root.output_text.trim();
  const pieces: string[] = [];
  for (const output of Array.isArray(root.output) ? root.output : []) {
    for (const item of Array.isArray(record(output).content) ? record(output).content as unknown[] : []) {
      const part = record(item);
      if (part.type === "refusal" || typeof part.refusal === "string") throw new Error("AI provider refused the classification request.");
      if (part.type === "output_text" && typeof part.text === "string") pieces.push(part.text);
    }
  }
  if (!pieces.length) throw new Error("AI provider completed without structured output.");
  return pieces.join("").trim();
}

function chatOutput(root: JsonRecord) {
  const choice = record(Array.isArray(root.choices) ? root.choices[0] : null);
  if (choice.finish_reason !== "stop") throw new Error(`AI provider did not finish cleanly (${String(choice.finish_reason || "unknown")}).`);
  const message = record(choice.message);
  if (typeof message.refusal === "string" && message.refusal.trim()) throw new Error("AI provider refused the classification request.");
  if (typeof message.content !== "string" || !message.content.trim()) throw new Error("AI provider completed without structured output.");
  return message.content.trim();
}

async function classify(input: JsonRecord, providerUrlRaw: string, providerToken: string, providerModel: string, protocolRaw: string) {
  if (!providerUrlRaw || !providerToken || !providerModel || !protocolRaw) throw new Error("AI model provider is not configured.");
  const providerUrl = requirePublicHttpsUrl(providerUrlRaw, "AI model provider URL");
  const protocol = providerProtocol(protocolRaw);
  if (providerModel.length > 200) throw new Error("AI model provider model is invalid.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  let providerResponse: Response;
  try {
    providerResponse = await fetch(providerUrl, {
      method: "POST",
      redirect: "error",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${providerToken}` },
      body: JSON.stringify(providerPayload(protocol, providerModel, input)),
      signal: controller.signal,
    });
  } finally { clearTimeout(timer); }
  const providerText = await providerResponse.text();
  if (providerText.length > 128_000) throw new Error("AI provider response exceeded the 128 KB safety limit.");
  if (!providerResponse.ok) throw new Error(`AI model provider failed with HTTP ${providerResponse.status}.`);
  let providerBody: JsonRecord;
  try { providerBody = record(providerText ? JSON.parse(providerText) : null); }
  catch { throw new Error("AI provider returned invalid JSON."); }
  const outputText = protocol === "openai_responses" ? responsesOutput(providerBody) : chatOutput(providerBody);
  if (outputText.length > 16_000) throw new Error("AI classifier structured output exceeded the 16 KB safety limit.");
  let structured: unknown;
  try { structured = JSON.parse(outputText); }
  catch (error) { throw new Error("AI provider structured output was not valid JSON.", { cause: error }); }
  return parseResult(structured);
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return response({ ok: false, error: "Method not allowed." }, 405);
  if (request.headers.get("x-nxq-worker-token") !== secret("NXQ_AUTOMATION_WORKER_TOKEN")) return response({ ok: false, error: "Unauthorized." }, 401);
  const admin = createClient(secret("SUPABASE_URL"), secret("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const providerUrl = optionalSecret("NXQ_AI_MODEL_PROVIDER_URL");
  const providerToken = optionalSecret("NXQ_AI_MODEL_PROVIDER_TOKEN");
  const providerModel = optionalSecret("NXQ_AI_MODEL_PROVIDER_MODEL");
  const protocolRaw = optionalSecret("NXQ_AI_MODEL_PROVIDER_PROTOCOL");
  const providerConfigured = Boolean(providerUrl && providerToken && providerModel && protocolRaw);
  const runtimeEnvironment = optionalSecret("NXQ_RUNTIME_ENVIRONMENT").toLowerCase();
  const stagingOnlyFallbackAllowed = new Set(["staging", "stage", "development", "dev", "test", "qa"]).has(runtimeEnvironment);
  let providerCallAttempted = false;
  let providerCallSucceeded = false;
  let job: Job | null = null;
  try {
    const claim = await admin.rpc("claim_next_external_automation_job", { target_execution_target: "ai", worker_name: workerName, target_job_types: ["classify_website_change_request"] });
    if (claim.error) throw new Error(`Classifier job claim failed: ${claim.error.message}`);
    job = normalize(claim.data);
    await admin.rpc("record_worker_heartbeat", {
      target_worker_key: workerName,
      target_execution_target: "ai",
      target_status: providerConfigured ? "healthy" : "degraded",
      target_metadata: { worker_version: workerVersion, provider_configured: providerConfigured, provider_call_proven: false, provider_protocol: protocolRaw, model_configured: Boolean(providerModel), routing_authority: "database_trigger", checked_at: new Date().toISOString() },
      target_last_error: providerConfigured ? null : "AI model provider URL/token/model/protocol are not configured.",
    });
    if (!job) return response({ ok: true, claimed: false, provider_configured: providerConfigured });
    const changeId = String(job.payload?.change_request_id || "");
    if (!changeId) throw new Error("Classifier job missing change_request_id.");
    const [changeRes, clientRes, approvalRes] = await Promise.all([
      admin.from("website_change_requests").select("id,client_id,project_id,request_type,title,description,priority,risk_level,status,requested_payload").eq("id", changeId).eq("client_id", job.client_id).eq("project_id", job.project_id).single(),
      admin.from("clients").select("id,status").eq("id", job.client_id).single(),
      admin.from("owner_approval_requests").select("id").eq("client_id", job.client_id).eq("request_type", "website_setup_review").eq("status", "accepted").limit(1).maybeSingle(),
    ]);
    if (!clientRes.data || !["approved", "active"].includes(String(clientRes.data.status))) throw new Error("Client is not eligible for automated change classification.");
    if (!approvalRes.data) throw new Error("Original owner approval is required for automated website changes.");
    if (!changeRes.data) throw new Error("Change request not found.");
    if (["published", "cancelled", "failed"].includes(String(changeRes.data.status))) throw new Error("Change request is already terminal.");

    const deterministic = deterministicResult(changeRes.data.requested_payload);
    let result: ClassifierResult;
    if (deterministic) result = deterministic;
    else if (!providerConfigured && stagingOnlyFallbackAllowed) {
      result = {
        route: "owner_review",
        confidence: 1,
        reason: "External AI classification is unavailable in staging, so NXQ safely routed this request to owner review.",
      };
    }
    else {
      providerCallAttempted = true;
      result = await classify({ request_type: changeRes.data.request_type, title: changeRes.data.title, description: changeRes.data.description, priority: changeRes.data.priority, risk_level: changeRes.data.risk_level, requested_payload: changeRes.data.requested_payload }, providerUrl, providerToken, providerModel, protocolRaw);
      providerCallSucceeded = true;
      const providerHealthUpdate = await admin.from("nxq_provider_connections").update({ status: "healthy", last_checked_at: new Date().toISOString(), last_success_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() }).eq("provider_key", "change_classifier_ai").eq("scope_type", "global").is("scope_id", null);
      if (providerHealthUpdate.error) throw new Error(`Classifier provider health update failed: ${providerHealthUpdate.error.message}`);
      await admin.rpc("record_worker_heartbeat", {
        target_worker_key: workerName,
        target_execution_target: "ai",
        target_status: "healthy",
        target_metadata: { worker_version: workerVersion, provider_configured: true, provider_call_proven: true, provider_protocol: protocolRaw, model_configured: true, routing_authority: "database_trigger", last_success_at: new Date().toISOString() },
        target_last_error: null,
      });
    }
    const classifier = deterministic
      ? "deterministic-v1"
      : !providerConfigured && stagingOnlyFallbackAllowed
        ? "staging-owner-review-v1"
        : "model-provider-v3";
    const evidence = {
      classifier,
      confidence: result.confidence,
      reason: result.reason || null,
      provider_configured: providerConfigured,
      staging_fallback: classifier === "staging-owner-review-v1",
      classified_at: new Date().toISOString(),
      routing_authority: "database_trigger",
    };

    if (result.route === "safe_patch") {
      const patch = validatePatch(result.patch);
      if (result.confidence < 0.9 || !patch) {
        await admin.from("website_change_requests").update({ status: "blocked", last_error: "Classifier suggested automation but confidence/patch validation did not meet NXQ safety rules.", automation_plan: { route: "owner_review", ...evidence } }).eq("id", changeId).eq("client_id", job.client_id);
      } else {
        const update = await admin.from("website_change_requests").update({ status: "submitted", risk_level: "low", requested_payload: { patch }, last_error: null, automation_plan: { route: "classifier_to_structured_edge", source: deterministic ? "deterministic_classifier" : "ai_classifier", ...evidence } }).eq("id", changeId).eq("client_id", job.client_id);
        if (update.error) throw new Error(`Safe classification update failed: ${update.error.message}`);
      }
    } else if (result.route === "needs_info") {
      const question = result.question || "NXQ needs a little more information before this change can be completed safely.";
      const update = await admin.from("website_change_requests").update({ status: "needs_info", last_error: null, automation_plan: { route: "needs_info", question, ...evidence } }).eq("id", changeId).eq("client_id", job.client_id);
      if (update.error) throw new Error(`Needs-info update failed: ${update.error.message}`);
    } else {
      const reason = result.reason || "NXQ requires owner review before this change can continue safely.";
      const update = await admin.from("website_change_requests").update({ status: "blocked", last_error: reason, automation_plan: { route: "owner_review", ...evidence } }).eq("id", changeId).eq("client_id", job.client_id);
      if (update.error) throw new Error(`Owner-review update failed: ${update.error.message}`);
    }

    const complete = await admin.rpc("complete_external_automation_job", { target_job_id: job.id, worker_name: workerName, target_result: { change_request_id: changeId, route: result.route, confidence: result.confidence, classifier, routing_authority: "database_trigger" } });
    if (complete.error) throw new Error(`Classifier job completion failed: ${complete.error.message}`);
    return response({ ok: true, claimed: true, job_id: job.id, change_request_id: changeId, route: result.route, confidence: result.confidence, classifier });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown change classifier failure";
    await admin.rpc("record_worker_heartbeat", { target_worker_key: workerName, target_execution_target: "ai", target_status: "error", target_metadata: { worker_version: workerVersion, provider_configured: providerConfigured, provider_call_proven: false, provider_protocol: protocolRaw, model_configured: Boolean(providerModel), routing_authority: "database_trigger", failed_at: new Date().toISOString() }, target_last_error: message });
    if (job?.id) await admin.rpc("fail_external_automation_job", { target_job_id: job.id, worker_name: workerName, target_error: message });
    if (providerCallAttempted && !providerCallSucceeded) await admin.from("nxq_provider_connections").update({ status: "error", last_checked_at: new Date().toISOString(), last_error: message.slice(0, 500), updated_at: new Date().toISOString() }).eq("provider_key", "change_classifier_ai").eq("scope_type", "global").is("scope_id", null);
    return response({ ok: false, job_id: job?.id || null, error: message }, 500);
  }
});
