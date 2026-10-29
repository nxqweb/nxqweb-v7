// Gateway for the "My assistant" portal page: calls the client functions of migration 278 (supabase/migrations/278_site_assistant.sql). It is only used when the ONE switch in
// src/lib/siteAssistantConfig.ts is set; until migration 278 is applied that switch stays null and nothing calls these functions (docs/SITE_ASSISTANT_PLAN.md).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssistantState, EntryInput, SiteAssistantGateway } from "./siteAssistant";

type Raw = Record<string, unknown>;
const text = (value: unknown) => (typeof value === "string" ? value : "");

function parseState(raw: unknown): AssistantState {
  const root = (raw && typeof raw === "object" ? raw : {}) as Raw;
  const settings = (root.settings && typeof root.settings === "object" ? root.settings : {}) as Raw;
  const entries = Array.isArray(root.entries) ? (root.entries as Raw[]) : [];
  const unanswered = Array.isArray(root.unanswered) ? (root.unanswered as Raw[]) : [];
  return {
    settings: { enabled: settings.enabled === true, greeting: text(settings.greeting), fallbackText: text(settings.fallback_text) },
    entries: entries.map((entry) => ({
      id: text(entry.id), question: text(entry.question), answer: text(entry.answer), enabled: entry.enabled !== false,
      altPhrasings: Array.isArray(entry.alt_phrasings) ? (entry.alt_phrasings as unknown[]).filter((item): item is string => typeof item === "string") : [],
    })),
    unanswered: unanswered.map((item) => ({ id: text(item.id), question: text(item.question), timesAsked: typeof item.times_asked === "number" ? item.times_asked : 1, lastAskedAt: text(item.last_asked_at) })),
  };
}

export function createSiteAssistantGateway(supabase: SupabaseClient): SiteAssistantGateway {
  const check = (result: { error: { message: string } | null }) => { if (result.error) throw new Error(result.error.message); };
  return {
    async load() {
      const result = await supabase.rpc("get_my_assistant");
      check(result);
      return parseState(result.data);
    },
    async saveSettings(input) {
      check(await supabase.rpc("save_my_assistant_settings", { enabled_value: input.enabled, greeting_value: input.greeting, fallback_value: input.fallbackText }));
    },
    async saveEntry(input: EntryInput) {
      check(await supabase.rpc("save_my_assistant_entry", { entry_id_value: input.id, question_value: input.question, alt_value: input.altPhrasings, answer_value: input.answer, enabled_value: input.enabled }));
    },
    async deleteEntry(id) {
      check(await supabase.rpc("delete_my_assistant_entry", { entry_id_value: id }));
    },
    async dismissQuestion(id) {
      check(await supabase.rpc("dismiss_my_assistant_question", { question_id_value: id }));
    },
  };
}
