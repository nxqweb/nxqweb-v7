// Offline test for the Claude (Anthropic Messages) protocol helpers and their wiring.
// No network, no secrets. Node >= 22.18 imports the .ts helper directly.
import fs from "node:fs";
import { anthropicHeaders, anthropicOutput, anthropicPayload, ANTHROPIC_PROTOCOL } from "../supabase/functions/_shared/anthropic-messages.ts";

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`PASS  ${name}`);
  else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); }
}
function throwsWith(fn, fragment) {
  try { fn(); return false; } catch (error) { return String(error?.message || error).includes(fragment); }
}

check("protocol name is anthropic_messages", ANTHROPIC_PROTOCOL === "anthropic_messages");

const headers = anthropicHeaders("TEST_TOKEN_NOT_REAL");
check("headers use x-api-key and a pinned anthropic-version, not a Bearer header",
  headers["x-api-key"] === "TEST_TOKEN_NOT_REAL" && headers["anthropic-version"] === "2023-06-01" && !("Authorization" in headers));

const schema = { type: "object", properties: { a: { type: "string" } }, required: ["a"], additionalProperties: false };
const payload = anthropicPayload({ model: "claude-sonnet-5-5", system: "SYS", user: "USER", schema, maxTokens: 8000 });
check("payload carries model, max_tokens, system, one user message",
  payload.model === "claude-sonnet-5-5" && payload.max_tokens === 8000 && payload.system === "SYS"
  && payload.messages.length === 1 && payload.messages[0].role === "user" && payload.messages[0].content === "USER");
check("payload requests JSON-schema structured output via output_config.format",
  payload.output_config?.format?.type === "json_schema" && payload.output_config.format.schema === schema);
const forbidden = ["temperature", "top_p", "top_k", "thinking", "tool_choice", "budget_tokens", "prefill"];
check("payload sends no parameters that current Claude models reject",
  forbidden.every((key) => !(key in payload)) && payload.messages.every((message) => message.role !== "assistant"));

check("output joins text blocks and ignores thinking blocks",
  anthropicOutput({ stop_reason: "end_turn", content: [{ type: "thinking", thinking: "" }, { type: "text", text: "{\"a\":" }, { type: "text", text: "\"b\"}" }] }, "refused") === "{\"a\":\"b\"}");
check("refusal stop reason becomes the supplied refusal error",
  throwsWith(() => anthropicOutput({ stop_reason: "refusal", content: [] }, "REFUSED_MSG"), "REFUSED_MSG"));
check("max_tokens stop reason is rejected as truncated",
  throwsWith(() => anthropicOutput({ stop_reason: "max_tokens", content: [{ type: "text", text: "{" }] }, "r"), "truncated"));
check("unknown or missing stop reason is rejected",
  throwsWith(() => anthropicOutput({ content: [{ type: "text", text: "{}" }] }, "r"), "did not finish cleanly"));
check("empty text output is rejected",
  throwsWith(() => anthropicOutput({ stop_reason: "end_turn", content: [{ type: "thinking", thinking: "x" }] }, "r"), "without structured output"));

// Wiring: both AI workers must accept the protocol and use the helper headers/output.
for (const file of ["generate-business-build-plan", "classify-business-change-request"]) {
  const source = fs.readFileSync(`supabase/functions/${file}/index.ts`, "utf8");
  check(`${file} imports the shared Claude helpers`, source.includes("../_shared/anthropic-messages.ts"));
  check(`${file} accepts anthropic_messages as a protocol`, source.includes("value === ANTHROPIC_PROTOCOL"));
  check(`${file} uses the Claude headers for that protocol`, source.includes("anthropicHeaders("));
  check(`${file} reads Claude output through anthropicOutput`, source.includes("anthropicOutput("));
  check(`${file} keeps the OpenAI protocols`, source.includes('"openai_responses"') && source.includes('"openai_chat_completions"'));
  check(`${file} still validates the provider URL as public HTTPS`, source.includes("requirePublicHttpsUrl("));
}

// The AI instructions must name the words the grounding validator rejects, or the model keeps writing them and the build-plan job fails after retries.
const planSource = fs.readFileSync("supabase/functions/generate-business-build-plan/index.ts", "utf8");
const bannedLine = (planSource.match(/NXQX rejects any plan that uses these words[^"]*/) || [""])[0].toLowerCase();
const mustName = ["trusted", "reliable", "dependable", "expert", "professional", "best", "fast", "safe", "quality", "premium", "licensed", "insured", "guarantee", "same-day", "24/7"];
check("build-plan instructions name the words the grounding validator rejects", bannedLine !== "" && mustName.every((word) => bannedLine.includes(word)));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll Claude-protocol checks passed (offline; does not prove a live provider call).");
process.exit(failures ? 1 : 0);
