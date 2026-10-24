// Static checks that tie the DRAFT website Q&A assistant together (migration draft 11, the answer function, the widget): the limits agree, the permissions are closed,
// and the safety rules in the function and the widget stay in place. The database behaviour itself is tested by docs/drafts/migrations/11_site_assistant.test.sql
// (run by the local full-schema harness); the widget by scripts/manual/assistant-widget-e2e.mjs.
import fs from "node:fs";
import { ASSISTANT_LIMITS } from "../supabase/functions/_shared/assistant-match.mjs";

let failures = 0;
function check(name, ok) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failures += 1;
}
const sql = fs.readFileSync("docs/drafts/migrations/11_site_assistant.sql", "utf8");
const fn = fs.readFileSync("docs/drafts/functions/answer-site-question/index.ts", "utf8");
const widget = fs.readFileSync("docs/drafts/site/assistant.js", "utf8");
const portal = fs.existsSync("src/pages/ClientAssistant.tsx") ? fs.readFileSync("src/pages/ClientAssistant.tsx", "utf8") : "";

const rules = {
  "the database limits are the same numbers as the matcher's (question 3-160, answer 2-600, 5 other wordings, 50 answers, 200-character unanswered)": (s) =>
    s.includes(`between 3 and ${ASSISTANT_LIMITS.question}`) && s.includes(`between 2 and ${ASSISTANT_LIMITS.answer}`) && s.includes(`jsonb_array_length(alt_phrasings) <= ${ASSISTANT_LIMITS.altPhrasings}`)
    && s.includes(`>= ${ASSISTANT_LIMITS.entries} then raise exception`) && s.includes("between 3 and 200"),
  "every table is closed to signed-in clients and visitors (RLS on, all privileges revoked)": (s) =>
    ["client_assistant_settings", "client_assistant_entries", "client_assistant_unanswered"].every((t) => s.includes(`alter table public.${t} enable row level security;`) && s.includes(`revoke all on table public.${t} from public, anon, authenticated;`)),
  "the visitor-side functions can only be called by the service role": (s) =>
    s.includes("revoke all on function public.site_assistant_lookup(text) from public, anon, authenticated;") && s.includes("revoke all on function public.site_assistant_record_unanswered(text, text) from public, anon, authenticated;")
    && s.includes("grant execute on function public.site_assistant_lookup(text) to service_role;") && s.includes("grant execute on function public.site_assistant_record_unanswered(text, text) to service_role;"),
  "the client functions are for signed-in clients only, never visitors": (s) =>
    ["get_my_assistant()", "save_my_assistant_settings(boolean, text, text)", "save_my_assistant_entry(uuid, text, jsonb, text, boolean)", "delete_my_assistant_entry(uuid)", "dismiss_my_assistant_question(uuid)"]
      .every((f) => s.includes(`revoke all on function public.${f} from public, anon;`) && s.includes(`grant execute on function public.${f} to authenticated;`)),
  "the assistant starts OFF": (s) => /enabled boolean not null default false,\s*\n\s*greeting text/.test(s),
  "unanswered questions are never kept if they look like personal details or links (any @, seven digits in total, link schemes, //, bare web addresses)": (s) =>
    s.includes("if cleaned ~ '@'") && s.includes("regexp_replace(cleaned, '[^[:digit:]]', '', 'g')) >= 7") && s.includes("hxxps?|www") && s.includes("cleaned ~ '//'") && s.includes("(com|net|org|io|co|us|biz|info|me|app|dev|xyz|ly"),
  "when the unanswered list is full, the least-asked go first (junk cannot push out real questions)": (s) => s.includes("order by times_asked desc, last_asked_at desc, id offset 100"),
  "settings and delete take the same per-client lock as saving an answer": (s) => (s.match(/hashtextextended\('assistant-entries:'/g) || []).length >= 3,
  "no IP address or visitor identity is stored with a question": (s) => !/ip_address|user_agent|fingerprint|visitor_id/i.test(s.split("create table if not exists public.client_assistant_unanswered")[1].split(");")[0]),
};
for (const [name, test] of Object.entries(rules)) check(name, test(sql));

const at = (f, text) => f.indexOf(text);
const fnRules = {
  "the origin is enforced with the same answer as every other refusal (no oracle for form keys)": (f) =>
    f.includes('!(form.allowed_origins || []).includes(origin)') && f.includes('form.status !== "active"') && !/Origin is not allowed/.test(f) && /return respond\(UNAVAILABLE, 404, origin\)/.test(f),
  "the bot trap is checked before any database work": (f) => at(f, "if (clean(payload.company_website, 500))") > 0 && at(f, "if (clean(payload.company_website, 500))") < at(f, "createClient("),
  "empty, too-long, unknown-action and non-object requests are refused before any database work": (f) =>
    at(f, "Please type a question.") > 0 && at(f, "Please type a question.") < at(f, "createClient(") && at(f, "Unknown request.") < at(f, "createClient(") && at(f, "must be a JSON object") < at(f, "createClient("),
  "the plan and billing gate is READ-ONLY (client_feature_access) and never spends the shared monthly request allowance": (f) =>
    f.includes('admin.rpc("client_feature_access"') && f.includes('target_feature_key: "lead_capture"') && !/nxq_authorize_paid_capability|nxq_finalize_economic_usage/.test(f.replace(/\/\/.*$/gm, "")),
  "the per-visitor limit is checked before the per-form total, and the greeting call is limited too": (f) =>
    at(f, '"assistant_visitor_hourly"') > 0 && at(f, '"assistant_visitor_hourly"') < at(f, '"assistant_total_hourly"') && f.includes('"assistant_config_visitor_hourly"'),
  "the heavy lookup (all answers) happens only after the cheap checks and the rate limits": (f) => at(f, 'admin.rpc("site_assistant_lookup"') > at(f, 'reserve("assistant_total_hourly"') && at(f, 'admin.rpc("site_assistant_lookup"') > at(f, 'admin.rpc("client_feature_access"'),
  "visitors only ever get the matched answer text or the business's own not-sure message (never the list of answers)": (f) =>
    !/entries\s*:\s*site/.test(f) && !/respond\(\{[^}]*entries/.test(f) && f.includes("matched: true, answer: result.answer") && f.includes("message: site.fallback_text"),
  "it matches with the shared matcher and records only unanswered questions": (f) => f.includes("matchQuestion(question, site.entries)") && f.includes('"site_assistant_record_unanswered"'),
  "request size is capped while reading, not just by the header": (f) => f.includes("MAX_REQUEST_BYTES = 4096") && f.includes("readBodyLimited(req, MAX_REQUEST_BYTES)") && f.includes("await reader.cancel()") && !/await req\.text\(\)/.test(f),
};
for (const [name, test] of Object.entries(fnRules)) check(name, test(fn));

const widgetRules = {
  "the widget shows text only (no innerHTML, no eval, no document.write)": (w) => !/innerHTML|outerHTML|insertAdjacentHTML|eval\(|new Function|document\.write/.test(w),
  "it sends no cookies and talks only to the configured HTTPS endpoint": (w) => w.includes('credentials: "omit"') && w.includes("^https:\\/\\/") && !/localStorage|sessionStorage|document\.cookie/.test(w),
  "it loads no third-party code (strict site security policy)": (w) => !/<script|createElement\("script"\)|https?:\/\/(?!example)/.test(w.replace(/\/\/.*$/gm, "")),
  "keyboard and screen reader basics: labelled dialog, live log, Escape, visible focus, button labels": (w) => w.includes('role: "dialog"') && w.includes('"aria-live": "polite"') && w.includes('event.key === "Escape"') && w.includes("outline:3px") && w.includes('"aria-label": "Close"'),
  "it is off unless the builder turns it on": (w) => w.includes("config.enabled !== true) return"),
  "the contact link can only point at a section of the same page": (w) => w.includes("/^#[A-Za-z0-9_-]+$/"),
};
for (const [name, test] of Object.entries(widgetRules)) check(name, test(widget));

// ---- planted-bug controls: each mutation must make its rule fail
const plant = (name, source, from, to, rule) => check(`control: ${name}`, source.includes(from) && !rule(source.split(from).join(to)));
plant("a table left open to signed-in clients is noticed", sql, "revoke all on table public.client_assistant_entries from public, anon, authenticated;", "revoke all on table public.client_assistant_entries from public, anon;", rules["every table is closed to signed-in clients and visitors (RLS on, all privileges revoked)"]);
plant("a visitor function open to clients is noticed", sql, "revoke all on function public.site_assistant_lookup(text) from public, anon, authenticated;", "revoke all on function public.site_assistant_lookup(text) from public, anon;", rules["the visitor-side functions can only be called by the service role"]);
plant("an assistant that starts ON is noticed", sql, "enabled boolean not null default false,\n  greeting", "enabled boolean not null default true,\n  greeting", rules["the assistant starts OFF"]);
plant("a limit that drifts from the matcher is noticed", sql, "between 2 and 600", "between 2 and 800", rules["the database limits are the same numbers as the matcher's (question 3-160, answer 2-600, 5 other wordings, 50 answers, 200-character unanswered)"]);
plant("storing visitor IPs is noticed", sql, "times_asked integer not null default 1", "ip_address text, times_asked integer not null default 1", rules["no IP address or visitor identity is stored with a question"]);
plant("spending the shared request allowance per question is noticed", fn, 'admin.rpc("client_feature_access"', 'admin.rpc("nxq_authorize_paid_capability"', fnRules["the plan and billing gate is READ-ONLY (client_feature_access) and never spends the shared monthly request allowance"]);
plant("dropping the origin check is noticed", fn, "!(form.allowed_origins || []).includes(origin)", "false", fnRules["the origin is enforced with the same answer as every other refusal (no oracle for form keys)"]);
plant("a distinct origin error (an oracle) is noticed", fn, "return respond(UNAVAILABLE, 404, origin);\n\n    const forwarded", 'return respond({ ok: false, error: "Origin is not allowed." }, 403, origin);\n\n    const forwarded', fnRules["the origin is enforced with the same answer as every other refusal (no oracle for form keys)"]);
plant("moving the bot trap after the database is noticed", fn, 'if (clean(payload.company_website, 500)) return respond({ ok: true, matched: false, message: BOT_REPLY }, 200, origin);', "", fnRules["the bot trap is checked before any database work"]);
plant("dropping the per-visitor limit is noticed", fn, '"assistant_visitor_hourly"', '"assistant_nothing"', fnRules["the per-visitor limit is checked before the per-form total, and the greeting call is limited too"]);
plant("letting the greeting call run unlimited is noticed", fn, '"assistant_config_visitor_hourly"', '"assistant_nothing"', fnRules["the per-visitor limit is checked before the per-form total, and the greeting call is limited too"]);
plant("reading the whole body first is noticed", fn, "readBodyLimited(req, MAX_REQUEST_BYTES)", "req.text()", fnRules["request size is capped while reading, not just by the header"]);
plant("a gap in the personal-details filter is noticed", sql, "or cleaned ~ '//'", "", rules["unanswered questions are never kept if they look like personal details or links (any @, seven digits in total, link schemes, //, bare web addresses)"]);
plant("evicting by age only is noticed", sql, "order by times_asked desc, last_asked_at desc, id offset 100", "order by last_asked_at desc, id offset 100", rules["when the unanswered list is full, the least-asked go first (junk cannot push out real questions)"]);
plant("returning the whole answer list to visitors is noticed", fn, 'return respond({ ok: true, matched: true, answer: result.answer }, 200, origin);', 'return respond({ ok: true, matched: true, answer: result.answer, entries: site.entries }, 200, origin);', fnRules["visitors only ever get the matched answer text or the business's own not-sure message (never the list of answers)"]);
plant("innerHTML in the widget is noticed", widget, "const message = el(", "const q = document.body.innerHTML; const message = el(", widgetRules["the widget shows text only (no innerHTML, no eval, no document.write)"]);
plant("storing things in the browser is noticed", widget, 'credentials: "omit"', 'credentials: "omit", /* localStorage */', widgetRules["it sends no cookies and talks only to the configured HTTPS endpoint"]);

if (portal) {
  const portalRules = {
    "the portal page goes through the gateway only (no direct table access) and says plainly what the assistant does": (p) => !/\.from\(/.test(p) && /not AI/.test(p),
  };
  for (const [name, test] of Object.entries(portalRules)) check(name, test(portal));
}

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll site assistant draft checks passed.");
process.exit(failures ? 1 : 0);
