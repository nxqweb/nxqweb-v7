// Matches a website visitor's question to the answers the business typed in its portal. No AI and no network: plain word overlap, so it costs nothing,
// behaves the same every time, and can only ever say something the business wrote. If nothing matches clearly, it says so and the site offers the contact form.
// Pure module: the Edge function, the portal preview and the Node tests all run this same code.

export const ASSISTANT_LIMITS = {
  question: 160, // a saved question (and each alternative wording)
  altPhrasings: 5,
  answer: 600,
  entries: 50,
  visitorQuestion: 300,
};

const STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "am", "do", "does", "did", "you", "your", "yours", "i", "me", "my", "we", "our", "us", "it", "its",
  "can", "could", "would", "will", "should", "how", "what", "when", "where", "which", "who", "why", "to", "of", "for", "in", "on", "at", "by", "and", "or", "if", "so",
  "there", "any", "have", "has", "with", "about", "please", "just", "get", "got", "ok", "hi", "hello", "hey", "thanks", "thank", "need", "want", "like", "tell",
]);

// Letters and numbers in any language are kept (accents are folded so "credito" and "crédito" match); apostrophes are dropped so "don't" becomes "dont".
/** @param {unknown} text */
export function normalizeText(text) {
  return String(text ?? "").normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase().replace(/['\u2019`]+/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
}

// "Do you NOT offer weekends" must never get the answer written for "Do you offer weekends". Negation words are not part of the word overlap; instead a question and
// a saved phrase must agree on whether they are negated, or that phrase does not count.
const NEGATIONS = new Set(["no", "not", "never", "cannot", "cant", "dont", "doesnt", "didnt", "wont", "wouldnt", "isnt", "arent", "wasnt", "werent", "without", "none", "nothing", "nobody", "neither", "nor"]);
/** @param {unknown} text */
export function hasNegation(text) {
  return normalizeText(text).split(" ").some((word) => NEGATIONS.has(word));
}

// Very light stemming so "price"/"prices"/"pricing" and "booking"/"book" line up, without pulling in a library. Order matters: plural first, then -ing/-ed, then a
// trailing "e" (so price, prices and pricing all end up as "pric", and tree/trees as "tre").
function stem(input) {
  let word = input;
  if (word.length > 4 && /(sses|ches|shes|xes|zes)$/.test(word)) word = word.slice(0, -2);
  else if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss") && !word.endsWith("us")) word = word.slice(0, -1);
  if (word.length > 5 && word.endsWith("ing")) word = word.slice(0, -3);
  else if (word.length > 4 && word.endsWith("ed")) word = word.slice(0, -2);
  if (word.length > 3 && word.endsWith("e")) word = word.slice(0, -1);
  return word;
}

/** @param {unknown} text @returns {string[]} */
export function tokens(text) {
  const out = normalizeText(text).split(" ").filter((word) => word.length >= 2 && !STOPWORDS.has(word) && !NEGATIONS.has(word)).map(stem);
  return [...new Set(out)];
}

// Cosine overlap of two word sets: 1 = same words, 0 = nothing in common.
/** @param {string[]} a @param {string[]} b */
export function overlapScore(a, b) {
  if (!a.length || !b.length) return 0;
  const set = new Set(b);
  const shared = a.filter((word) => set.has(word)).length;
  return shared / Math.sqrt(a.length * b.length);
}

export const MATCH_THRESHOLD = 0.5; // below this the answer is not clear enough to give
export const AMBIGUOUS_MARGIN = 0.08; // two different answers this close together: do not guess

/**
 * @typedef {{ id: string, question: string, alt_phrasings?: string[], answer: string, enabled?: boolean }} AssistantEntry
 * @param {unknown} visitorQuestion
 * @param {AssistantEntry[]} entries
 * @returns {{ matched: true, answer: string, entryId: string, score: number } | { matched: false, reason: "empty" | "too_long" | "no_entries" | "no_match" | "ambiguous" }}
 */
export function matchQuestion(visitorQuestion, entries) {
  const raw = String(visitorQuestion ?? "").trim();
  if (!raw) return { matched: false, reason: "empty" };
  if (raw.length > ASSISTANT_LIMITS.visitorQuestion) return { matched: false, reason: "too_long" };
  const live = (Array.isArray(entries) ? entries : []).filter((entry) => entry && entry.enabled !== false && typeof entry.answer === "string" && entry.answer.trim() && typeof entry.question === "string");
  if (live.length === 0) return { matched: false, reason: "no_entries" };
  const asked = tokens(raw);
  if (asked.length === 0) return { matched: false, reason: "no_match" };
  const askedNegated = hasNegation(raw);

  const scored = live.map((entry) => {
    const phrases = [entry.question, ...(Array.isArray(entry.alt_phrasings) ? entry.alt_phrasings : [])];
    let best = 0;
    for (const phrase of phrases) {
      if (hasNegation(phrase) !== askedNegated) continue; // "not" on one side only: they are not asking the same thing
      const words = tokens(phrase);
      // A single-word question must be covered by the phrase, and a phrase of many unrelated words must not win on one shared word.
      const shared = asked.filter((word) => words.includes(word)).length;
      if (shared === 0) continue;
      best = Math.max(best, overlapScore(asked, words));
    }
    return { entry, score: best };
  }).sort((x, y) => y.score - x.score);

  const top = scored[0];
  if (!top || top.score < MATCH_THRESHOLD) return { matched: false, reason: "no_match" };
  const runnerUp = scored.find((item, index) => index > 0 && item.entry.answer.trim() !== top.entry.answer.trim());
  if (runnerUp && top.score - runnerUp.score < AMBIGUOUS_MARGIN && runnerUp.score >= MATCH_THRESHOLD) return { matched: false, reason: "ambiguous" };
  return { matched: true, answer: top.entry.answer.trim(), entryId: String(top.entry.id), score: Math.round(top.score * 100) / 100 };
}

// Checks one entry a business is about to save. Plain text only: the widget shows answers with textContent, but we also refuse markup and links so nothing
// surprising is ever stored.
/** @param {{ question?: unknown, alt_phrasings?: unknown, answer?: unknown }} entry @returns {string[]} */
export function entryProblems(entry) {
  const problems = [];
  const question = String(entry?.question ?? "").trim();
  const answer = String(entry?.answer ?? "").trim();
  const alts = Array.isArray(entry?.alt_phrasings) ? entry.alt_phrasings : [];
  if (question.length < 3) problems.push("Write the question a visitor might ask (at least 3 characters).");
  if (question.length > ASSISTANT_LIMITS.question) problems.push(`Keep the question under ${ASSISTANT_LIMITS.question} characters.`);
  if (answer.length < 2) problems.push("Write the answer.");
  if (answer.length > ASSISTANT_LIMITS.answer) problems.push(`Keep the answer under ${ASSISTANT_LIMITS.answer} characters.`);
  if (alts.length > ASSISTANT_LIMITS.altPhrasings) problems.push(`Use at most ${ASSISTANT_LIMITS.altPhrasings} other ways of asking it.`);
  if (alts.some((alt) => typeof alt !== "string" || alt.trim().length > ASSISTANT_LIMITS.question)) problems.push(`Each other way of asking must be text under ${ASSISTANT_LIMITS.question} characters.`);
  if (tokens(question).length === 0) problems.push("The question needs at least one real word (not just words like \"the\" or \"how\").");
  const all = [question, answer, ...alts.map((alt) => String(alt))].join("\n");
  if (/<[^>]*>/.test(all)) problems.push("Please use plain text only (no HTML tags).");
  if (alts.some((alt) => typeof alt === "string" && alt.trim() && hasNegation(alt) !== hasNegation(question))) problems.push("The question and its other ways of asking must either all say \"not\" or all not say it, because they would be a different question.");
  if (/(https?:\/\/|www\.)\S+/i.test(answer)) problems.push("Answers cannot contain web links. Tell visitors to use the contact form or give a phone number instead.");
  return problems;
}
