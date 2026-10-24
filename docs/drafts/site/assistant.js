// DRAFT: website Q&A assistant widget (no AI) for client sites. NOT in templates/business-v1, so it is not part of any build yet.
// Self-contained on purpose (one file, its own styles, no libraries) so promoting it is: copy to templates/business-v1/assistant.js, add it to the builder's
// blueprint file list and the template's <script type="module" src="./assistant.js"> line, and let the builder write the `assistant` block into site.config.js
// (see docs/SITE_ASSISTANT_PLAN.md, "Promotion checklist"). Until then every client site is byte-for-byte unchanged.
//
// What it does: a small "Ask a question" button; the panel sends the visitor's question to the answer function and shows the business's own answer, or says
// it is not sure and points to the contact form. Answers are shown with textContent only, so nothing a server returns can inject markup. The site's strict
// Content-Security-Policy (script-src 'self') is respected: no inline scripts, no third-party code.

const DEFAULT_GREETING = "Hi! Ask me a question about our business.";
const DEFAULT_TITLE = "Ask a question";
const UNAVAILABLE = "Sorry, the assistant is not available right now.";
const SWITCHED_OFF = "The assistant is not available at the moment. Please use the contact form and we will get back to you.";
const LOOKING = "Looking for an answer";
const TOO_MANY = "That is a lot of questions for now. Please try again later.";
const TIMEOUT_MS = 12000;

const STYLE = `
.nxq-ask-launch{position:fixed;right:max(16px,env(safe-area-inset-right));bottom:max(16px,env(safe-area-inset-bottom));z-index:60;min-height:48px;padding:0 18px;border-radius:999px;border:1px solid var(--line,rgba(255,255,255,.2));background:linear-gradient(135deg,var(--button-start,#94ebc7),var(--button-end,#9dc9ff));color:#06101a;font:inherit;font-weight:750;cursor:pointer;box-shadow:0 10px 30px rgba(0,0,0,.35)}
.nxq-ask-launch:focus-visible,.nxq-ask-panel button:focus-visible,.nxq-ask-panel input:focus-visible,.nxq-ask-panel a:focus-visible{outline:3px solid var(--text,#fff);outline-offset:2px}
.nxq-ask-panel{position:fixed;right:max(16px,env(safe-area-inset-right));bottom:calc(max(16px,env(safe-area-inset-bottom)) + 60px);z-index:61;width:min(380px,calc(100vw - 32px));max-height:min(560px,calc(100vh - 110px));display:flex;flex-direction:column;border-radius:20px;border:1px solid var(--line,rgba(255,255,255,.2));background:var(--surface,#10151c);color:var(--text,#f3f6fa);box-shadow:0 20px 50px rgba(0,0,0,.45)}
.nxq-ask-panel[hidden]{display:none}
.nxq-ask-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;border-bottom:1px solid var(--line,rgba(255,255,255,.2))}
.nxq-ask-head h2{margin:0;font-size:1rem}
.nxq-ask-close{min-width:44px;min-height:44px;border:0;background:transparent;color:inherit;font:inherit;font-size:1.3rem;cursor:pointer;border-radius:12px}
.nxq-ask-log{flex:1;overflow-y:auto;padding:14px 16px;display:flex;flex-direction:column;gap:10px}
.nxq-ask-msg{margin:0;padding:10px 12px;border-radius:14px;max-width:92%;line-height:1.45;overflow-wrap:anywhere}
.nxq-ask-msg.bot{background:var(--tint,rgba(255,255,255,.07));align-self:flex-start}
.nxq-ask-msg.you{background:linear-gradient(135deg,var(--button-start,#94ebc7),var(--button-end,#9dc9ff));color:#06101a;align-self:flex-end}
.nxq-ask-contact{display:inline-block;margin-top:8px;font-weight:700;color:inherit}
.nxq-ask-form{display:flex;gap:8px;padding:12px 16px 16px;border-top:1px solid var(--line,rgba(255,255,255,.2))}
.nxq-ask-form input[type=text]{flex:1;min-width:0;min-height:44px;padding:0 12px;border-radius:12px;border:1px solid var(--line,rgba(255,255,255,.3));background:var(--bg,#0b0f14);color:var(--text,#f3f6fa);font:inherit}
.nxq-ask-form button{min-height:44px;padding:0 16px;border-radius:12px;border:0;background:linear-gradient(135deg,var(--button-start,#94ebc7),var(--button-end,#9dc9ff));color:#06101a;font:inherit;font-weight:750;cursor:pointer}
.nxq-ask-form button[disabled]{opacity:.6;cursor:progress}
.nxq-ask-note{margin:0;padding:0 16px 12px;font-size:.8rem;opacity:.75}
.nxq-ask-hp{position:absolute;left:-9999px;width:1px;height:1px;opacity:0}
.nxq-ask-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media (max-width:480px){.nxq-ask-panel{right:8px;left:8px;width:auto;bottom:calc(max(12px,env(safe-area-inset-bottom)) + 60px)}}
`;

function el(tag, attrs = {}, text = "") {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (text) node.textContent = text;
  return node;
}

// options: { endpoint, formKey, title, greeting, contactHref, fetchImpl, root }. Returns { open, close, destroy } (used by tests and the page).
export function mountAssistant(options = {}) {
  const endpoint = typeof options.endpoint === "string" ? options.endpoint.trim() : "";
  const formKey = typeof options.formKey === "string" ? options.formKey.trim() : "";
  if (!endpoint || !formKey || !/^https:\/\//i.test(endpoint) && !options.allowInsecureEndpoint) return null;
  const doc = options.root?.ownerDocument || document;
  const root = options.root || doc.body;
  if (root.querySelector("[data-nxq-assistant]")) return null; // already on this page: a second copy would duplicate ids and the button
  const doFetch = options.fetchImpl || fetch.bind(globalThis);
  const title = String(options.title || DEFAULT_TITLE).slice(0, 60);
  const contactHref = typeof options.contactHref === "string" && /^#[A-Za-z0-9_-]+$/.test(options.contactHref) ? options.contactHref : "#contact";
  let greeting = String(options.greeting || DEFAULT_GREETING).slice(0, 200);

  const style = el("style", { "data-nxq-assistant": "" }, STYLE);
  const launcher = el("button", { type: "button", class: "nxq-ask-launch", "aria-expanded": "false", "aria-controls": "nxq-ask-panel" }, title);
  const panel = el("section", { id: "nxq-ask-panel", class: "nxq-ask-panel", role: "dialog", "aria-label": title, hidden: "" });
  const head = el("div", { class: "nxq-ask-head" });
  const heading = el("h2", {}, title);
  const closeButton = el("button", { type: "button", class: "nxq-ask-close", "aria-label": "Close" }, "×");
  head.append(heading, closeButton);
  const log = el("div", { class: "nxq-ask-log", role: "log", "aria-live": "polite", "aria-label": "Conversation" });
  const form = el("form", { class: "nxq-ask-form", autocomplete: "off" });
  const label = el("label", { for: "nxq-ask-input", class: "nxq-ask-sr" }, "Your question");
  const input = el("input", { id: "nxq-ask-input", name: "question", type: "text", maxlength: "300", required: "", placeholder: "Type your question", autocomplete: "off" });
  const trap = el("input", { name: "company_website", class: "nxq-ask-hp", tabindex: "-1", autocomplete: "off", "aria-hidden": "true" });
  const send = el("button", { type: "submit" }, "Ask");
  form.append(label, input, trap, send);
  const note = el("p", { class: "nxq-ask-note" }, "Please do not type phone numbers or email addresses here.");
  panel.append(head, log, form, note);
  root.append(style, launcher, panel);

  let opened = false;
  let greeted = false;
  let busy = false;
  let unavailable = false;

  function contactLink() {
    const link = el("a", { class: "nxq-ask-contact", href: contactHref }, "Go to the contact form");
    link.addEventListener("click", () => close(false));
    return link;
  }

  function add(kind, text, withContact = false) {
    const message = el("p", { class: `nxq-ask-msg ${kind}` }, text);
    if (withContact) message.append(doc.createElement("br"), contactLink());
    log.append(message);
    log.scrollTop = log.scrollHeight;
    return message;
  }

  async function post(body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await doFetch(endpoint, { method: "POST", credentials: "omit", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ form_key: formKey, ...body }), signal: controller.signal });
      let data = null;
      try { data = await response.json(); } catch { data = null; }
      return { status: response.status, data };
    } finally { clearTimeout(timer); }
  }

  // The default greeting shows at once; the business's own greeting replaces it when it arrives. If the site says the assistant is switched off (or the form is gone),
  // the panel says so and the box is disabled, instead of inviting a question it cannot answer. A network problem is not "off": the default greeting stays.
  async function greetOnce() {
    if (greeted) return;
    greeted = true;
    const first = add("bot", greeting);
    try {
      const result = await post({ action: "config" });
      if (result.data?.ok === true && typeof result.data.greeting === "string" && result.data.greeting.trim()) first.textContent = result.data.greeting.trim().slice(0, 200);
      else if (result.status === 404 || result.data?.ok === false) {
        first.textContent = SWITCHED_OFF;
        first.append(doc.createElement("br"), contactLink());
        input.disabled = true;
        send.disabled = true;
        unavailable = true;
      }
    } catch { /* the default greeting is fine */ }
  }

  function open() {
    if (opened) return;
    opened = true;
    panel.hidden = false;
    launcher.setAttribute("aria-expanded", "true");
    void greetOnce();
    input.focus();
  }
  function close(returnFocus = true) {
    if (!opened) return;
    opened = false;
    panel.hidden = true;
    launcher.setAttribute("aria-expanded", "false");
    if (returnFocus) launcher.focus();
  }

  launcher.addEventListener("click", () => (opened ? close() : open()));
  closeButton.addEventListener("click", () => close());
  panel.addEventListener("keydown", (event) => { if (event.key === "Escape") { event.stopPropagation(); close(); } });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    const question = input.value.trim();
    if (!question || unavailable) return;
    busy = true;
    send.disabled = true;
    input.value = "";
    add("you", question);
    const waiting = add("bot", LOOKING);
    waiting.setAttribute("aria-busy", "true");
    try {
      const result = await post({ action: "ask", question, company_website: trap.value });
      waiting.remove();
      if (result.status === 429) add("bot", TOO_MANY, true);
      else if (result.data?.ok === true && result.data.matched === true && typeof result.data.answer === "string") add("bot", result.data.answer.slice(0, 600));
      else if (result.data?.ok === true && typeof result.data.message === "string") add("bot", result.data.message, true);
      else add("bot", UNAVAILABLE, true);
    } catch {
      waiting.remove();
      add("bot", UNAVAILABLE, true);
    } finally {
      busy = false;
      if (!unavailable) send.disabled = false;
      const active = doc.activeElement;
      if (opened && !unavailable && (active === doc.body || active === input || panel.contains(active))) input.focus();
    }
  });

  return { open, close, destroy() { style.remove(); launcher.remove(); panel.remove(); } };
}

// On a client site: start only when the builder turned it on in site.config.js. Failing to load the config module simply means no assistant.
async function start() {
  try {
    const configUrl = "./site.config.js"; // a variable so a bundler (the test page) does not try to resolve it; on a real site the browser loads it next to this file
    const { siteConfig } = await import(/* @vite-ignore */ configUrl);
    const config = siteConfig?.assistant || {};
    if (config.enabled !== true) return;
    mountAssistant({ endpoint: config.endpoint, formKey: config.formKey || siteConfig?.leads?.formKey, title: config.title, greeting: config.greeting });
  } catch { /* no assistant */ }
}
if (typeof document !== "undefined" && !globalThis.__NXQ_ASSISTANT_NO_AUTOSTART) void start();
