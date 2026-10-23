// Mounts the draft widget with a fake answer function so the browser test needs no network. Behaviour is chosen by the question text.
import { mountAssistant } from "/docs/drafts/site/assistant.js";

window.__mount = mountAssistant;

window.__asked = [];
const params = new URLSearchParams(location.search);
document.documentElement.dataset.theme = params.get("theme") || "midnight_blue";
document.documentElement.dataset.mode = params.get("mode") === "light" ? "light" : "dark";

const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const fakeFetch = async (url, init) => {
  const body = JSON.parse(init.body);
  window.__asked.push({ url, init: { method: init.method, credentials: init.credentials }, body });
  if (body.action === "config") {
    if (params.get("config") === "off") return reply(404, { ok: false, error: "The assistant is unavailable." });
    if (params.get("config") === "network") throw new Error("network down");
    if (params.get("config") === "slow") await new Promise((resolve) => setTimeout(resolve, 700));
    return reply(200, { ok: true, greeting: "Hello! Ask about hours, stumps or where we work.", fallback_text: "x" });
  }
  const q = String(body.question || "").toLowerCase();
  if (q.includes("slow")) await new Promise((resolve) => setTimeout(resolve, 600));
  if (q.includes("hours")) return reply(200, { ok: true, matched: true, answer: "We are open Monday to Friday, 8am to 5pm." });
  if (q.includes("html")) return reply(200, { ok: true, matched: true, answer: '<img src=x onerror="window.__pwned=1"><b>bold</b>' });
  if (q.includes("limit")) return reply(429, { ok: false, error: "Too many questions for now." });
  if (q.includes("down")) throw new Error("network down");
  if (q.includes("broken")) return reply(500, "not json");
  return reply(200, { ok: true, matched: false, message: "I am not sure about that. Please use the contact form and we will get back to you." });
};

window.__widget = mountAssistant({ endpoint: "https://example.test/functions/v1/answer-site-question", formKey: "FORM-test", title: "Ask a question", greeting: "Hi there", fetchImpl: fakeFetch });
