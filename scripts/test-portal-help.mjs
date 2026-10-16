// Offline test: the portal assistant, "Report a problem", the "?" help words, and the plan-table wording. Answers must be true and safe, links must go
// to real pages, anything needing a person must be offered to the team, and reports must never carry sign-in codes from the address bar.
import fs from "node:fs";
import { answerQuestion, faq, maxTeamQuestionLength, noAnswerText, suggestedQuestions, teamMessage } from "../src/lib/assistantAnswers.ts";
import { buildProblemReport, problemCategories, problemLimits, safePath } from "../src/lib/problemReport.ts";
import { helpTerms } from "../src/lib/helpTerms.ts";

let failures = 0;
function check(name, ok, detail = "") { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); } }
const read = (p) => fs.readFileSync(p, "utf8");
const app = read("src/App.tsx");

// ---- assistant
check("every answer has a unique id, real text, and no promise words", new Set(faq.map((f) => f.id)).size === faq.length && faq.length >= 18 && faq.every((f) => f.answer.length > 40 && f.keywords.length > 0 && !/guarantee|100%|always rank|will rank|instantly rank|no risk/i.test(f.answer)));
check("every link goes to a real page", faq.filter((f) => f.link).every((f) => f.link.href === "/client" || f.link.href === "/portal/login" || app.includes(`path === "${f.link.href}"`)), faq.filter((f) => f.link && !(f.link.href === "/client" || f.link.href === "/portal/login" || app.includes(`path === "${f.link.href}"`))).map((f) => f.link.href).join(","));
const asked = (q) => answerQuestion(q);
check("common questions get the right answer", asked("What is SEO?").matched === "seo" && asked("how do I add a product?").matched === "add-product" && asked("How do I change my website").matched === "change" && asked("how long will my website take").matched === "timing" && asked("Can customers order by email?").matched === "email-orders" && asked("what are your prices").matched === "plans");
check("a short word never matches inside a longer word", asked("which one should I pick").matched !== "hello" && asked("what do they offer").matched !== "hello" && asked("stockholm office").matched !== "stock" && asked("sheep").matched === null);
check("billing, cancelling and privacy always go to a person", ["refund please", "I want to cancel", "delete my data", "why was I charged"].every((q) => { const r = asked(q); return r.offerTeam && ["billing", "privacy"].includes(r.matched); }));
check("an unknown question is offered to the team and invents nothing", (() => { const r = asked("what colour is the moon on tuesdays"); return r.matched === null && r.offerTeam && r.text === noAnswerText; })());
check("an empty question just asks for one", asked("  ").matched === null && !asked("  ").offerTeam);
check("the assistant says plainly that it is not a person or a live AI", /not a person/i.test(asked("are you a bot").text) && /prepared list/i.test(read("src/lib/assistantAnswers.ts")));
check("what goes to the team is labelled, flat text and length-limited", teamMessage("hello\n\n  world").startsWith("[Assistant question] hello world") && teamMessage("x".repeat(5000)).length <= "[Assistant question] ".length + maxTeamQuestionLength);
check("suggested questions each get a real answer", suggestedQuestions.length >= 3 && suggestedQuestions.every((q) => asked(q).matched !== null));

// ---- problem report
const ok = { category: "broken", text: "I pressed Save and nothing happened.", path: "/client/commerce/products", width: 390, height: 800 };
const built = buildProblemReport(ok);
check("a good report is labelled with category, page and screen size", built.ok && built.message.startsWith("[Problem report] Something is broken\nPage: /client/commerce/products\nScreen: 390x800\n\nI pressed Save"));
check("sign-in codes in the address are never included", safePath("/client?code=SECRET#access_token=abc") === "/client" && !buildProblemReport({ ...ok, path: "/client/x?token=SECRET#frag" }).message.includes("SECRET") && safePath("javascript:alert(1)") === "/" && safePath("//evil.com") === "/");
check("too short, too long, or no category is refused kindly", !buildProblemReport({ ...ok, text: "bad" }).ok && !buildProblemReport({ ...ok, text: "x".repeat(problemLimits.max + 1) }).ok && !buildProblemReport({ ...ok, category: "nope" }).ok && buildProblemReport({ ...ok, text: "x".repeat(problemLimits.max) }).ok);
check("four plain categories", problemCategories.length === 4 && problemCategories.every((c) => c.label.length > 5));

// ---- wiring
const portal = read("src/pages/ClientPortal.tsx");
const chat = read("src/components/AssistantChat.tsx");
const report = read("src/components/ReportProblem.tsx");
check("the portal shows the assistant instead of a direct message box", /<AssistantChat canSend=\{Boolean\(client\)\} sendToTeam=\{sendToTeam\} \/>/.test(portal) && !/Type your message here/.test(portal) && !/Message support/.test(portal));
check("nothing reaches the team unless the client presses the send button", /sendToTeam\(teamMessage\(turn\.offerTeam\)\)/.test(chat) && (chat.match(/sendToTeam\(/g) || []).length === 1 && /onClick=\{\(\) => void send\(turn\)\}/.test(chat));
check("the chat is a labelled live log, keyboard reachable, and Enter sends (Shift+Enter adds a line)", /role="log"/.test(chat) && /aria-live="polite"/.test(chat) && /tabIndex=\{0\}/.test(chat) && /event\.key === "Enter" && !event\.shiftKey/.test(chat));
check("Report a problem shows on client pages only and uses the existing message function", /pathname\.startsWith\("\/client"\) \? <ReportProblem \/>/.test(app) && /send_client_portal_message/.test(report) && !/\.from\(|insert\(/.test(report));
check("the report dialog is a native dialog, labelled, and not force-closed by cleanup", /<dialog/.test(report) && /aria-labelledby="report-problem-title"/.test(report) && !/return \(\) => .*close\(\)/.test(report));
check("report errors are announced and tied to the box", /role="alert"/.test(report) && /aria-invalid/.test(report) && /aria-describedby/.test(report));

// ---- help words
const termKeys = Object.keys(helpTerms);
check("each help word has a short plain meaning", termKeys.length >= 10 && termKeys.every((k) => helpTerms[k].meaning.length > 30 && helpTerms[k].meaning.length < 260));
const used = [...new Set(["src/pages/ClientBusinessSeo.tsx", "src/pages/ClientBusinessAnalytics.tsx", "src/pages/ClientPortal.tsx", "src/pages/PublicHome.tsx"].flatMap((f) => [...read(f).matchAll(/(?:<HelpTerm term="|help: ")([a-zA-Z]+)"/g)].map((m) => m[1])))];
check("every help word used on a page exists, and SEO, analytics, conversion and domain are explained", used.every((u) => termKeys.includes(u)) && ["seo", "analytics", "conversion", "domain"].every((u) => used.includes(u)), used.join(","));
const help = read("src/components/HelpTerm.tsx");
check("the ? button is a real button with a name, expanded state and Escape", /<button type="button"/.test(help) && /aria-expanded=\{open\}/.test(help) && /aria-label=\{`What is \$\{entry\.name\}\?`\}/.test(help) && /event\.key === "Escape"/.test(help));

// ---- plan table wording matches what the database really gives
const home = read("src/pages/PublicHome.tsx");
const tiers = read("supabase/migrations/186_canonical_business_tier_runtime.sql");
const growthAnalytics = /\('business','growth','advanced_analytics',true/.test(tiers);
const starterAnalytics = /\('business','starter','advanced_analytics',false/.test(tiers);
const intelHeat = /mouse_tracking/.test(tiers) || /\('business','intelligence','mouse_tracking',true/.test(read("supabase/migrations/130_server_side_tier_entitlements.sql"));
check("Growth is shown as getting click and scroll summaries because the database gives it analytics, and Starter does not", growthAnalytics && starterAnalytics && /label: "Behavior analytics"[^}]*starter: "—", growth: "Page, click \+ scroll summaries"/.test(home));
check("heat maps are shown as an Intelligence feature because only Intelligence and Enterprise have mouse tracking", intelHeat && /intelligence: "Adds heat maps \(with consent\)"/.test(home));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll portal-help checks passed (offline).");
process.exit(failures ? 1 : 0);
