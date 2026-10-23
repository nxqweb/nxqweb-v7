// Manual-testing harness (never part of the production build): mounts the "My assistant" page with an in-memory stand-in for the database functions, no login,
// no network. The stand-in follows the same rules as draft migration 11 (limits, plain text, no links, off-when-empty). The test drives it through window.assistantSim.
// ?state=empty|full  starts empty or with sample answers.   ?fail=load|save  makes loading or saving fail.
import { createRoot } from "react-dom/client";
import "../../../src/styles/nxq.css";
import "../../../src/styles/portal-premium.css";
import "../../../src/styles/portal-polish.css";
import "../../../src/styles/final-frontend-polish.css";
import "../../../src/styles/plan-forms.css";
import "../../../src/styles/nxqx-neural-glass.css";
import "../../../src/styles/premium-v2.css";
import { ClientAssistant } from "../../../src/pages/ClientAssistant";
import type { AssistantState, SiteAssistantGateway } from "../../../src/lib/siteAssistant";

const params = new URLSearchParams(window.location.search);
let counter = 100;
const state: AssistantState = {
  settings: { enabled: false, greeting: "", fallbackText: "" },
  entries: params.get("state") === "full" ? [
    { id: "e1", question: "What are your hours?", altPhrasings: ["When are you open"], answer: "Monday to Friday, 8am to 5pm.", enabled: true },
    { id: "e2", question: "Do you remove stumps?", altPhrasings: [], answer: "Yes, stump grinding is one of our services.", enabled: true },
  ] : [],
  unanswered: params.get("state") === "full" ? [{ id: "u1", question: "what about parking", timesAsked: 3, lastAskedAt: "2026-10-20T10:00:00Z" }] : [],
};
const sim = { calls: [] as string[], state };
(window as unknown as { assistantSim: typeof sim }).assistantSim = sim;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const plain = (text: string) => !/[<>]/.test(text);
const hasLink = (text: string) => /(https?:\/\/|www\.)\S+/i.test(text);

const gateway: SiteAssistantGateway = {
  async load() { sim.calls.push("load"); if (params.get("fail") === "load") throw new Error("boom"); return clone(state); },
  async saveSettings(input) {
    sim.calls.push(`settings:${input.enabled}`);
    if (params.get("fail") === "save") throw new Error("boom");
    if (input.enabled && !state.entries.some((entry) => entry.enabled)) throw new Error("Add at least one answer before turning the assistant on.");
    if (hasLink(input.greeting) || hasLink(input.fallbackText)) throw new Error("Messages cannot contain web links.");
    state.settings = { enabled: input.enabled, greeting: input.greeting, fallbackText: input.fallbackText };
  },
  async saveEntry(input) {
    sim.calls.push(`entry:${input.id ?? "new"}`);
    if (params.get("fail") === "save") throw new Error("boom");
    if (!plain(input.question + input.answer)) throw new Error("Please use plain text only (no HTML tags).");
    if (input.id === null && state.entries.length >= 50) throw new Error("You can have up to 50 answers.");
    if (input.id) {
      const index = state.entries.findIndex((entry) => entry.id === input.id);
      if (index < 0) throw new Error("Answer not found.");
      state.entries[index] = { id: input.id, question: input.question, altPhrasings: input.altPhrasings, answer: input.answer, enabled: input.enabled };
    } else {
      state.entries.push({ id: `n${counter += 1}`, question: input.question, altPhrasings: input.altPhrasings, answer: input.answer, enabled: input.enabled });
    }
    if (!state.entries.some((entry) => entry.enabled)) state.settings.enabled = false;
  },
  async deleteEntry(id) {
    sim.calls.push(`delete:${id}`);
    state.entries = state.entries.filter((entry) => entry.id !== id);
    if (!state.entries.some((entry) => entry.enabled)) state.settings.enabled = false;
  },
  async dismissQuestion(id) { sim.calls.push(`dismiss:${id}`); state.unanswered = state.unanswered.filter((item) => item.id !== id); },
};

createRoot(document.getElementById("root")!).render(<ClientAssistant gateway={params.get("gateway") === "none" ? null : gateway} />);
