declare module "*/assistant-match.mjs" {
  export const ASSISTANT_LIMITS: { question: number; altPhrasings: number; answer: number; entries: number; visitorQuestion: number };
  export const MATCH_THRESHOLD: number;
  export const AMBIGUOUS_MARGIN: number;
  export function normalizeText(text: unknown): string;
  export function tokens(text: unknown): string[];
  export function overlapScore(a: string[], b: string[]): number;
  export type AssistantMatchEntry = { id: string; question: string; alt_phrasings?: string[]; answer: string; enabled?: boolean };
  export type MatchResult =
    | { matched: true; answer: string; entryId: string; score: number }
    | { matched: false; reason: "empty" | "too_long" | "no_entries" | "no_match" | "ambiguous" };
  export function matchQuestion(visitorQuestion: unknown, entries: AssistantMatchEntry[]): MatchResult;
  export function entryProblems(entry: { question?: unknown; alt_phrasings?: unknown; answer?: unknown }): string[];
}
