// "My assistant" portal helpers (src/lib/siteAssistant.ts): test-it previews use the server's own matcher, error words are friendly, defaults agree everywhere.
import fs from "node:fs";
import { DEFAULT_FALLBACK, DEFAULT_GREETING, STARTER_QUESTIONS, checkEntryInput, friendlyAssistantError, previewAnswer, splitAlternatives } from "../src/lib/siteAssistant.ts";
import { matchQuestion } from "../supabase/functions/_shared/assistant-match.mjs";

let failures = 0;
function check(name, ok) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failures += 1;
}
const entries = [
  { id: "a", question: "What are your hours?", altPhrasings: ["When are you open"], answer: "Monday to Friday.", enabled: true },
  { id: "b", question: "Do you remove stumps?", altPhrasings: [], answer: "Yes.", enabled: false },
];

const hit = previewAnswer("when are you open", entries, "");
check("a matching test question shows the business's own answer", hit.kind === "answer" && hit.text === "Monday to Friday.");
const server = matchQuestion("when are you open", entries.map((e) => ({ id: e.id, question: e.question, alt_phrasings: e.altPhrasings, answer: e.answer, enabled: e.enabled })));
check("the preview agrees with the server's matcher (same file)", server.matched && server.answer === hit.text);
check("hidden answers are not used", previewAnswer("do you remove stumps", entries, "").kind === "unsure");
const miss = previewAnswer("do you fix roofs", entries, "Please call us.");
check("an unmatched question shows the business's not-sure message, or the default when it is empty", miss.kind === "unsure" && miss.text === "Please call us." && previewAnswer("do you fix roofs", entries, "   ").text === DEFAULT_FALLBACK);
check("every reason has a plain explanation", ["", "x".repeat(400)].every((q) => previewAnswer(q, entries, "").kind === "unsure" && previewAnswer(q, entries, "").why.length > 10) && previewAnswer("hours", [], "").why === "You have no answers turned on yet.");
check("ambiguity is explained, not guessed", previewAnswer("tree removal price", [
  { id: "1", question: "tree removal price", altPhrasings: [], answer: "One.", enabled: true },
  { id: "2", question: "removal tree price", altPhrasings: [], answer: "Two.", enabled: true },
], "").why.includes("does not guess"));

check("other wordings are split by line and blanks are dropped", JSON.stringify(splitAlternatives("a\n\n  b  \n")) === JSON.stringify(["a", "b"]) && splitAlternatives("").length === 0);
check("the same entry rules as the server apply before saving", checkEntryInput({ question: "hi", altPhrasings: [], answer: "" }).length >= 2 && checkEntryInput({ question: "Hours?", altPhrasings: [], answer: "See https://x.example" }).some((p) => /links/.test(p)) && checkEntryInput({ question: "Hours?", altPhrasings: [], answer: "9 to 5" }).length === 0);

check("database messages shown to the client are plain words, with the technical prefix removed", friendlyAssistantError("ERROR: Add at least one answer before turning the assistant on.") === "Add at least one answer before turning the assistant on." && friendlyAssistantError(new Error("Answers cannot contain web links.")) === "Answers cannot contain web links.");
check("anything else gets a calm generic line that says nothing was changed, never a raw error", /Nothing was changed/.test(friendlyAssistantError("duplicate key value violates unique constraint")) && !/constraint/.test(friendlyAssistantError("duplicate key value violates unique constraint")) && /Nothing was changed/.test(friendlyAssistantError(undefined)) && /Nothing was changed/.test(friendlyAssistantError({ weird: true })));
check("starter questions are plain, short and never come with answers", STARTER_QUESTIONS.length >= 4 && STARTER_QUESTIONS.every((q) => q.length < 60 && !/[<>]/.test(q)));

const sql = fs.readFileSync("supabase/migrations/278_site_assistant.sql", "utf8");
const widget = fs.readFileSync("templates/business-v1/assistant.js", "utf8");
check("the default greeting and not-sure message are the same in the portal, the database and the widget", sql.includes(`'${DEFAULT_GREETING}'`) && widget.includes(`"${DEFAULT_GREETING}"`) && sql.includes("I am not sure about that. Please use the contact form and we will get back to you.") && DEFAULT_FALLBACK === "I am not sure about that. Please use the contact form and we will get back to you.");

const page = fs.readFileSync("src/pages/ClientAssistant.tsx", "utf8");
check("the page says plainly that it is not AI and only says what the business wrote", page.includes("<strong>not AI</strong>") && page.includes("only ever says what you wrote here"));
check("the page never touches the database directly (gateway only)", !/supabase|\.from\(|\.rpc\(/.test(page));
check("control: a page that talked to the database directly would be noticed", /\.rpc\(/.test(page + '\nsupabase.rpc("x")'));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll site assistant portal checks passed.");
process.exit(failures ? 1 : 0);
