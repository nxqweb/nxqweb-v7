// The website Q&A matcher: plain word overlap, only ever the business's own answers, refuses to guess.
import fs from "node:fs";
import { ASSISTANT_LIMITS, MATCH_THRESHOLD, entryProblems, hasNegation, matchQuestion, normalizeText, overlapScore, tokens } from "../supabase/functions/_shared/assistant-match.mjs";

let failures = 0;
function check(name, ok) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failures += 1;
}

const entries = [
  { id: "e1", question: "What are your opening hours?", alt_phrasings: ["When are you open", "What time do you close"], answer: "We are open Monday to Friday, 8am to 5pm." },
  { id: "e2", question: "Do you remove stumps?", alt_phrasings: ["stump grinding"], answer: "Yes, stump grinding is one of our services." },
  { id: "e3", question: "What areas do you serve?", alt_phrasings: ["Do you come to Plano"], answer: "We work in Dallas, Plano, Frisco and nearby." },
  { id: "e4", question: "How much does a tree removal cost?", answer: "Prices depend on the job. Send us a request for an estimate." },
];

check("text is normalised to plain lowercase words (apostrophes dropped)", normalizeText("  What's YOUR Price?! ") === "whats your price" && normalizeText("don't") === "dont" && normalizeText("don\u2019t") === "dont");
const same = (a, b) => JSON.stringify(tokens(a)) === JSON.stringify(tokens(b));
check("filler words are dropped", tokens("What are the").length === 0 && tokens("what do you charge").length === 1);
check("plurals, -ing and -ed forms line up (price/prices/pricing, tree/trees, stump/stumps, book/booked/booking, box/boxes)", same("price", "prices") && same("price", "pricing") && same("tree", "trees") && same("stump", "stumps") && same("book", "booked") && same("book", "booking") && same("box", "boxes") && same("bus", "bus"));
check("ordinary different words do not collapse together (known, accepted: a few pairs like plan/plane and car/care do, which only matters if they are the ONLY shared word, and the threshold guards that)", !same("tree", "tire") && !same("stump", "stun") && !same("hour", "house") && !same("open", "opening hours"));
check("identical words score 1, nothing in common scores 0", overlapScore(["a", "b"], ["a", "b"]) === 1 && overlapScore(["a"], ["b"]) === 0 && overlapScore([], ["a"]) === 0);

const hours = matchQuestion("what time are you open?", entries);
check("a question in other words still finds the hours answer", hours.matched && hours.entryId === "e1" && /Monday to Friday/.test(hours.answer));
check("the saved question itself matches", matchQuestion("Do you remove stumps?", entries).entryId === "e2");
check("an alternative wording matches", matchQuestion("do you come to plano", entries).entryId === "e3");
check("it returns the business's exact answer text, never anything written by the code", matchQuestion("how much for tree removal", entries).answer === entries[3].answer);

const none = matchQuestion("can you fix my roof gutters", entries);
check("an unrelated question is not answered (the site offers the contact form)", none.matched === false && none.reason === "no_match");
check("a single shared word in a long phrase is not enough", matchQuestion("tree", [{ id: "x", question: "Do you offer emergency tree removal after storms in winter", answer: "Yes." }]).matched === false);
check("empty, blank and too-long questions are refused with a reason", matchQuestion("", entries).reason === "empty" && matchQuestion("   ", entries).reason === "empty" && matchQuestion("x".repeat(ASSISTANT_LIMITS.visitorQuestion + 1), entries).reason === "too_long");
check("a business with no answers gets 'no_entries', and disabled entries are ignored", matchQuestion("hours", []).reason === "no_entries" && matchQuestion("opening hours", [{ ...entries[0], enabled: false }]).reason === "no_entries");
check("two different answers that fit equally well are not guessed between", matchQuestion("tree removal price", [
  { id: "a", question: "tree removal price", answer: "Answer one." },
  { id: "b", question: "removal tree price", answer: "Answer two." },
]).reason === "ambiguous");
check("two entries with the SAME answer are not ambiguous", matchQuestion("tree removal price", [
  { id: "a", question: "tree removal price", answer: "Same." },
  { id: "b", question: "removal tree price", answer: "Same." },
]).matched === true);
check("odd input never crashes", [null, undefined, 5, {}, []].every((v) => { try { return matchQuestion(v, entries).matched === false; } catch { return false; } }) && matchQuestion("hours", null).reason === "no_entries" && matchQuestion("hours", [null, 5, {}]).reason === "no_entries");
check("the match threshold is not trivially low", MATCH_THRESHOLD >= 0.4 && MATCH_THRESHOLD <= 0.7);

// ---- other languages and accents
const spanish = [{ id: "s1", question: "\u00bfAceptan tarjetas de cr\u00e9dito?", answer: "S\u00ed, todas las principales.", alt_phrasings: [] }];
check("accents are folded, so a question typed without them still matches", matchQuestion("aceptan tarjetas de credito", spanish).matched === true && matchQuestion("ACEPTAN TARJETAS DE CR\u00c9DITO", spanish).matched === true);
const chinese = [{ id: "c1", question: "\u4f60\u4eec\u63a5\u53d7\u4fe1\u7528\u5361\u5417", answer: "\u63a5\u53d7\u3002", alt_phrasings: [] }];
check("a question in a language without Latin letters is matched (and can be saved), instead of being reduced to nothing", matchQuestion("\u4f60\u4eec\u63a5\u53d7\u4fe1\u7528\u5361\u5417", chinese).matched === true && entryProblems({ question: "\u4f60\u4eec\u63a5\u53d7\u4fe1\u7528\u5361\u5417", answer: "ok" }).length === 0);
check("full-width and mixed characters are normalised", normalizeText("\uff28\uff4f\uff55\uff52\uff53") === "hours");

// ---- negation: the opposite question must never get the "yes" answer
const weekends = [{ id: "w1", question: "Do you offer weekend appointments?", answer: "Yes, Saturdays 9-1.", alt_phrasings: [] }];
check("a negated question is not answered with the un-negated answer", matchQuestion("Do you NOT offer weekend appointments", weekends).matched === false && matchQuestion("do you never offer weekend appointments", weekends).matched === false && matchQuestion("Don't you offer weekend appointments?", weekends).matched === false);
check("the plain question still matches", matchQuestion("do you offer weekend appointments", weekends).matched === true);
check("a negated saved question matches a negated visitor question only", (() => { const no = [{ id: "n1", question: "Can't you come on Sundays?", answer: "We do not work Sundays.", alt_phrasings: [] }]; return matchQuestion("cant you come on sundays", no).matched === true && matchQuestion("can you come on sundays", no).matched === false; })());
check("negation words are detected, ordinary words are not", hasNegation("we cannot do that") && hasNegation("without a deposit") && !hasNegation("we can do that") && !hasNegation("a note about nothing special".replace("nothing", "items")));
check("saving a question whose other wordings disagree about 'not' is refused", entryProblems({ question: "Do you offer weekends?", alt_phrasings: ["Do you not work weekends"], answer: "Yes" }).some((p) => /not/.test(p)));

// ---- what a business may save
check("a normal entry has no problems", entryProblems({ question: "Do you remove stumps?", answer: "Yes we do.", alt_phrasings: ["stump grinding"] }).length === 0);
check("too short, too long, and word-less questions are refused with plain messages", entryProblems({ question: "hi", answer: "ok" }).length >= 1 && entryProblems({ question: "x".repeat(200), answer: "yes" }).some((p) => /under 160/.test(p)) && entryProblems({ question: "how do the", answer: "yes" }).some((p) => /real word/.test(p)));
check("an empty or oversized answer is refused", entryProblems({ question: "hours?", answer: "" }).some((p) => /Write the answer/.test(p)) && entryProblems({ question: "hours?", answer: "x".repeat(601) }).some((p) => /under 600/.test(p)));
check("markup and web links are refused", entryProblems({ question: "hours?", answer: "<b>9-5</b>" }).some((p) => /plain text/.test(p)) && entryProblems({ question: "hours?", answer: "See https://example.com for more" }).some((p) => /links/.test(p)) && entryProblems({ question: "hours?", answer: "see www.example.com" }).some((p) => /links/.test(p)));
check("too many alternative wordings are refused", entryProblems({ question: "hours?", answer: "9-5", alt_phrasings: ["a1", "b2", "c3", "d4", "e5", "f6"] }).some((p) => /at most 5/.test(p)));

// ---- planted-bug controls: the matcher source mutated must make a check fail
const source = fs.readFileSync("supabase/functions/_shared/assistant-match.mjs", "utf8");
const mutated = (from, to) => source.split(from).join(to);
async function load(src) {
  const os = await import("node:os"); const path = await import("node:path"); const { pathToFileURL } = await import("node:url");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nxq-match-plant-"));
  const file = path.join(dir, "assistant-match.mjs");
  fs.writeFileSync(file, src);
  const mod = await import(pathToFileURL(file).href);
  fs.rmSync(dir, { recursive: true, force: true });
  return mod;
}
const lowThreshold = await load(mutated("export const MATCH_THRESHOLD = 0.5;", "export const MATCH_THRESHOLD = 0.01;"));
check("control: a threshold of almost zero would answer the roof-gutter question (and is noticed)", lowThreshold.matchQuestion("can you fix my roof gutters tree", entries).matched === true && none.matched === false);
const noAmbiguity = await load(mutated("if (runnerUp && top.score - runnerUp.score < AMBIGUOUS_MARGIN && runnerUp.score >= MATCH_THRESHOLD) return", "if (false) return"));
check("control: dropping the ambiguity guard would guess between two answers (and is noticed)", noAmbiguity.matchQuestion("tree removal price", [{ id: "a", question: "tree removal price", answer: "Answer one." }, { id: "b", question: "removal tree price", answer: "Answer two." }]).matched === true);
const noNegation = await load(mutated("if (hasNegation(phrase) !== askedNegated) continue;", ""));
check("control: ignoring negation would answer the opposite question (and is noticed)", noNegation.matchQuestion("Do you NOT offer weekend appointments", weekends).matched === true && matchQuestion("Do you NOT offer weekend appointments", weekends).matched === false);
const asciiOnly = await load(mutated('.replace(/[^\\p{L}\\p{N}]+/gu, " ")', '.replace(/[^a-z0-9]+/g, " ")'));
check("control: reducing text to ASCII letters would lose other languages (and is noticed)", asciiOnly.matchQuestion("\u4f60\u4eec\u63a5\u53d7\u4fe1\u7528\u5361\u5417", chinese).matched === false && matchQuestion("\u4f60\u4eec\u63a5\u53d7\u4fe1\u7528\u5361\u5417", chinese).matched === true);
const linkOk = await load(mutated("if (/(https?:\\/\\/|www\\.)\\S+/i.test(answer))", "if (false)"));
check("control: allowing links in answers is noticed", linkOk.entryProblems({ question: "hours?", answer: "see https://example.com" }).length === 0 && entryProblems({ question: "hours?", answer: "see https://example.com" }).length > 0);

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll assistant matcher checks passed.");
process.exit(failures ? 1 : 0);
