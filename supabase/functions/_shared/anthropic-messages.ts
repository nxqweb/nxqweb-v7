// Claude (Anthropic Messages API) protocol helpers for the NXQX AI workers.
// Pure functions only: no network calls, no environment reads, no secrets.
// The caller supplies the full endpoint URL (for example https://api.anthropic.com/v1/messages)
// through the existing NXQ_AI_MODEL_PROVIDER_URL setting and validates it with requirePublicHttpsUrl.

type JsonRecord = Record<string, unknown>;

export const ANTHROPIC_PROTOCOL = "anthropic_messages" as const;
const ANTHROPIC_VERSION = "2023-06-01";

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

export function anthropicHeaders(token: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-api-key": token,
    "anthropic-version": ANTHROPIC_VERSION,
  };
}

// Structured output uses output_config.format (JSON schema). Thinking tokens count toward
// max_tokens on current models, so callers pass a ceiling with headroom. No sampling,
// prefill, forced tool_choice, or budget_tokens parameters are sent: current models reject them.
export function anthropicPayload(options: {
  model: string;
  system: string;
  user: string;
  schema: JsonRecord;
  maxTokens: number;
}) {
  return {
    model: options.model,
    max_tokens: options.maxTokens,
    system: options.system,
    messages: [{ role: "user", content: options.user }],
    output_config: { format: { type: "json_schema", schema: options.schema } },
  };
}

// Returns the concatenated text blocks. Thinking blocks are ignored. Refusals, truncation, and
// empty output are errors so the NXQX validators never see a partial or declined result.
export function anthropicOutput(root: JsonRecord, refusalMessage: string): string {
  const stopReason = root.stop_reason;
  if (stopReason === "refusal") throw new Error(refusalMessage);
  if (stopReason === "max_tokens") throw new Error("AI provider output was truncated (max_tokens).");
  if (stopReason !== "end_turn") {
    throw new Error(`AI provider did not finish cleanly (${String(stopReason || "unknown")}).`);
  }
  const pieces: string[] = [];
  for (const block of Array.isArray(root.content) ? root.content : []) {
    const part = record(block);
    if (part.type === "text" && typeof part.text === "string") pieces.push(part.text);
  }
  const output = pieces.join("").trim();
  if (!output) throw new Error("AI provider completed without structured output.");
  return output;
}
