// "My assistant" in the client portal: the pure rules (what can be saved, how a test question is answered, friendly error words) and the types the page needs.
// The answer matching is the SAME file the server uses (supabase/functions/_shared/assistant-match.mjs), so "Try it" shows exactly what a visitor would get.
// The database calls are a draft gateway (docs/drafts/ui/siteAssistantSupabaseGateway.ts) until the assistant migration is promoted.
import { ASSISTANT_LIMITS, entryProblems, matchQuestion } from "../../supabase/functions/_shared/assistant-match.mjs";

export { ASSISTANT_LIMITS };

export type AssistantSettings = { enabled: boolean; greeting: string; fallbackText: string };
export type AssistantEntry = { id: string; question: string; altPhrasings: string[]; answer: string; enabled: boolean };
export type UnansweredQuestion = { id: string; question: string; timesAsked: number; lastAskedAt: string };
export type AssistantState = { settings: AssistantSettings; entries: AssistantEntry[]; unanswered: UnansweredQuestion[] };
export type EntryInput = { id: string | null; question: string; altPhrasings: string[]; answer: string; enabled: boolean };

export type SiteAssistantGateway = {
  load(): Promise<AssistantState>;
  saveSettings(input: AssistantSettings): Promise<void>;
  saveEntry(input: EntryInput): Promise<void>;
  deleteEntry(id: string): Promise<void>;
  dismissQuestion(id: string): Promise<void>;
};

// Same wording as the database defaults, so what the client sees is what visitors get when the boxes are empty.
export const DEFAULT_GREETING = "Hi! Ask me a question about our business.";
export const DEFAULT_FALLBACK = "I am not sure about that. Please use the contact form and we will get back to you.";

// Starting points only: the client still writes every answer.
export const STARTER_QUESTIONS = ["What are your hours?", "Where do you work?", "How do I get a price?", "Do you offer estimates?", "How do I contact you?"];

export const emptyAssistantState: AssistantState = { settings: { enabled: false, greeting: "", fallbackText: "" }, entries: [], unanswered: [] };

// One answer per line in the "other ways of asking" box; blank lines are dropped.
export function splitAlternatives(text: string): string[] {
  return text.split("\n").map((line) => line.trim()).filter(Boolean);
}

export function checkEntryInput(input: { question: string; altPhrasings: string[]; answer: string }): string[] {
  return entryProblems({ question: input.question, alt_phrasings: input.altPhrasings, answer: input.answer });
}

export type PreviewResult = { kind: "answer"; text: string } | { kind: "unsure"; text: string; why: string };

// What a visitor would see for this question, using the answers on the page right now (including ones not saved yet is NOT done: only saved entries count).
export function previewAnswer(question: string, entries: AssistantEntry[], fallbackText: string): PreviewResult {
  const result = matchQuestion(question, entries.map((entry) => ({ id: entry.id, question: entry.question, alt_phrasings: entry.altPhrasings, answer: entry.answer, enabled: entry.enabled })));
  if (result.matched) return { kind: "answer", text: result.answer };
  const unsure = fallbackText.trim() || DEFAULT_FALLBACK;
  const why = result.reason === "ambiguous" ? "Two of your answers fit about equally well, so the assistant does not guess. Make the questions less alike, or add the missing words to one of them."
    : result.reason === "no_entries" ? "You have no answers turned on yet."
      : result.reason === "empty" ? "Type a question to try."
        : result.reason === "too_long" ? `Visitors can type up to ${ASSISTANT_LIMITS.visitorQuestion} characters.`
          : "None of your answers matched. Add an answer for this, or add other ways of asking to an existing one.";
  return { kind: "unsure", text: unsure, why };
}

// Database messages are already written in plain words; anything else gets a calm generic line.
export function friendlyAssistantError(message: unknown): string {
  const text = typeof message === "string" ? message : message instanceof Error ? message.message : "";
  const known = [
    "Add at least one answer", "up to 50 answers", "Answer not found", "plain text", "web links", "3 to 160", "2 to 600", "at most 5", "Choose on or off", "must be a list", "Client workspace not found",
  ];
  return known.some((part) => text.includes(part)) ? text.replace(/^.*?(ERROR:|error:)\s*/i, "").trim() : "That could not be saved right now. Nothing was changed. Please try again in a moment.";
}
