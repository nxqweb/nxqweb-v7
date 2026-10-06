// Tests for the email recipient logic (supabase/functions/_shared/notification-email.ts) with an in-memory store, plus static checks on how the sender uses it.
import fs from "node:fs";
import {
  CLIENT_EMAIL_TEMPLATES, OWNER_EMAIL_TEMPLATES, MAX_OWNER_RECIPIENTS,
  ensureEmailCopies, resolveRecipientEmail, isDeliverableEmail, emailNotificationsEnabled,
} from "../supabase/functions/_shared/notification-email.ts";

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`PASS  ${name}`);
  else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); }
}

function makeStore({ clients = {}, owners = [] } = {}) {
  const inserted = [];
  const store = {
    inserted,
    getClient: async (id) => clients[id] ?? null,
    listOwnerEmails: async () => owners,
    hasEmailCopy: async (src, to) => inserted.some((r) => r.metadata.email_of_delivery_id === src && r.recipient_reference === to),
    insertEmailDelivery: async (row) => { inserted.push(row); },
  };
  return store;
}
const real = { contact_email: "Pat.Owner@Gmail.com", qa_only: false, status: "approved" };
const inApp = (extra = {}) => ({ id: "d1", client_id: "c1", project_id: "p1", channel: "in_app", recipient_kind: "client", template_key: "billing_payment_failed", subject: "Payment could not be processed", body: "Please check your payment method.", priority: "high", ...extra });

// ---- address validation
check("a normal address is deliverable", isDeliverableEmail("a@b.co") && isDeliverableEmail("Pat.Owner@gmail.com"));
check("junk is not deliverable", ["", "nope", "a@b", "a b@c.com", null, undefined, 42, "a@@b.com"].every((v) => !isDeliverableEmail(v)));
check("reserved test domains are not deliverable (QA fixtures use .invalid)", ["qa@example.invalid", "x@foo.invalid", "x@example.com", "x@EXAMPLE.org"].every((v) => !isDeliverableEmail(v)));
check("the switch is only on for the exact word true", emailNotificationsEnabled("true") && emailNotificationsEnabled(" TRUE ") && !emailNotificationsEnabled("1") && !emailNotificationsEnabled("yes") && !emailNotificationsEnabled(undefined) && !emailNotificationsEnabled(""));

// ---- email copies for clients
let store = makeStore({ clients: { c1: real } });
let r = await ensureEmailCopies(store, inApp(), true);
check("a client money notice creates one email copy with the address filled in (lower-cased)", r.created === 1 && store.inserted[0].recipient_reference === "pat.owner@gmail.com" && store.inserted[0].channel === "email");
check("the copy keeps template, subject, body, priority, client and records its source", store.inserted[0].template_key === "billing_payment_failed" && store.inserted[0].subject === "Payment could not be processed" && store.inserted[0].priority === "high" && store.inserted[0].client_id === "c1" && store.inserted[0].metadata.email_of_delivery_id === "d1");
r = await ensureEmailCopies(store, inApp(), true);
check("running it again does not duplicate the copy (idempotent)", r.created === 0 && store.inserted.length === 1);
check("off switch creates nothing", (await ensureEmailCopies(makeStore({ clients: { c1: real } }), inApp(), false)).skipped === "email_notifications_off");
check("a QA-only client never gets email", (await ensureEmailCopies(makeStore({ clients: { c1: { ...real, qa_only: true } } }), inApp(), true)).skipped === "qa_only_client");
check("an archived client never gets email", (await ensureEmailCopies(makeStore({ clients: { c1: { ...real, status: "archived" } } }), inApp(), true)).skipped === "client_status_blocked");
check("a client with no or fake address gets nothing", (await ensureEmailCopies(makeStore({ clients: { c1: { ...real, contact_email: "qa@example.invalid" } } }), inApp(), true)).skipped === "no_deliverable_client_email" && (await ensureEmailCopies(makeStore({ clients: { c1: { ...real, contact_email: null } } }), inApp(), true)).skipped === "no_deliverable_client_email");
check("an unknown client gets nothing", (await ensureEmailCopies(makeStore(), inApp(), true)).skipped === "client_not_found");
check("a notice outside the allow-list stays in-app", (await ensureEmailCopies(makeStore({ clients: { c1: real } }), inApp({ template_key: "client_file_released" }), true)).skipped === "template_not_emailed");
check("an email-channel row is not copied again", (await ensureEmailCopies(makeStore({ clients: { c1: real } }), inApp({ channel: "email" }), true)).skipped === "not_in_app");
for (const kind of ["system", "lead", "organization_member"]) {
  check(`recipient kind ${kind} is never emailed`, (await ensureEmailCopies(makeStore({ clients: { c1: real } }), inApp({ recipient_kind: kind }), true)).skipped === "recipient_kind_not_emailed");
}

// ---- owner alerts
const ownerAlert = (extra = {}) => inApp({ id: "d2", recipient_kind: "owner", template_key: "billing_freeze_review_owner_attention", priority: "high", ...extra });
store = makeStore({ clients: { c1: real }, owners: ["boss@gmail.com", "BOSS@gmail.com", "second@proton.me", "bad", "qa@example.invalid"] });
r = await ensureEmailCopies(store, ownerAlert(), true);
check("an owner alert makes one copy per distinct valid owner address (dupes, junk and fake domains dropped)", r.created === 2 && store.inserted.map((x) => x.recipient_reference).sort().join() === "boss@gmail.com,second@proton.me");
check("owner copies keep recipient kind owner", store.inserted.every((x) => x.recipient_kind === "owner"));
check("owner alerts are capped", MAX_OWNER_RECIPIENTS === 5 && (await ensureEmailCopies(makeStore({ owners: Array.from({ length: 9 }, (_, i) => `o${i}@gmail.com`) }), ownerAlert({ client_id: null }), true)).created === 5);
check("an owner alert about a QA-only client stays in-app", (await ensureEmailCopies(makeStore({ clients: { c1: { ...real, qa_only: true } }, owners: ["boss@gmail.com"] }), ownerAlert(), true)).skipped === "qa_only_client");
check("no valid owner address means nothing is created", (await ensureEmailCopies(makeStore({ clients: { c1: real }, owners: ["nope"] }), ownerAlert(), true)).skipped === "no_deliverable_owner_email");
check("a client template is not emailed to an owner row and vice versa", (await ensureEmailCopies(makeStore({ clients: { c1: real }, owners: ["boss@gmail.com"] }), ownerAlert({ template_key: "billing_payment_failed" }), true)).skipped === "template_not_emailed" && (await ensureEmailCopies(makeStore({ clients: { c1: real } }), inApp({ template_key: "billing_freeze_review_owner_attention" }), true)).skipped === "template_not_emailed");
check("allow-lists are small and explicit", CLIENT_EMAIL_TEMPLATES.size === 5 && OWNER_EMAIL_TEMPLATES.size === 2);
check("a denied-setup notice is never emailed (the billing guard would always refuse it)", !CLIENT_EMAIL_TEMPLATES.has("business_setup_denied") && (await ensureEmailCopies(makeStore({ clients: { c1: real } }), inApp({ template_key: "business_setup_denied" }), true)).skipped === "template_not_emailed");

// ---- address for an email row about to be sent
const emailRow = (extra = {}) => ({ ...inApp({ channel: "email", id: "e1" }), recipient_reference: null, ...extra });
check("an email row with its own valid address uses it", (await resolveRecipientEmail(makeStore(), emailRow({ recipient_reference: "To@Gmail.com" }))).email === "to@gmail.com");
check("a digest row with no address falls back to the client's contact email", (await resolveRecipientEmail(makeStore({ clients: { c1: real } }), emailRow())).email === "pat.owner@gmail.com");
check("the fallback refuses QA-only clients, bad addresses, unknown clients and owner rows", (await resolveRecipientEmail(makeStore({ clients: { c1: { ...real, qa_only: true } } }), emailRow())).reason === "qa_only_client" && (await resolveRecipientEmail(makeStore({ clients: { c1: { ...real, contact_email: "x" } } }), emailRow())).reason === "no_deliverable_client_email" && (await resolveRecipientEmail(makeStore(), emailRow())).reason === "client_not_found" && (await resolveRecipientEmail(makeStore({ clients: { c1: real } }), emailRow({ recipient_kind: "owner" }))).reason === "no_recipient_address");
check("an invalid explicit address does not stop a client fallback but never sends to the invalid one", (await resolveRecipientEmail(makeStore({ clients: { c1: real } }), emailRow({ recipient_reference: "garbage" }))).email === "pat.owner@gmail.com");

// ---- how the sender uses it (static)
const sender = fs.readFileSync("supabase/functions/dispatch-notifications/index.ts", "utf8");
check("the sender creates email copies only when the owner's switch AND the adapter are on", sender.includes('adapterConfigured && emailNotificationsEnabled(Deno.env.get("NXQ_EMAIL_NOTIFICATIONS_ENABLED"))'));
check("the email copy is created before the in-app row is marked delivered, and a failure never blocks the in-app notice", sender.indexOf("ensureEmailCopies(emailStore, current, true)") > 0 && sender.indexOf("ensureEmailCopies(emailStore, current, true)") < sender.indexOf('status: "delivered", delivered_at') && /catch \(copyError\)/.test(sender));
check("email rows are blocked when the switch is off, before any address lookup or provider call", sender.indexOf("if (!emailCopiesEnabled)") > 0 && sender.indexOf("if (!emailCopiesEnabled)") < sender.indexOf("resolveRecipientEmail(emailStore, current)") && sender.indexOf("resolveRecipientEmail(emailStore, current)") < sender.indexOf("providerCallAttempted = true;\n        const result"));
check("a row with no deliverable address is blocked with a reason, not retried forever", sender.includes("No deliverable recipient email address (") && /status: "blocked", last_error: `No deliverable/.test(sender));
check("the adapter receives the resolved address", sender.includes("postAdapter({ ...current, recipient_reference: recipient.email })"));
check("a send refused by the billing guard is recorded as blocked with the reason, not skipped silently", sender.includes("capability denied|usage limit") && sender.includes("Send refused by billing guard:") && sender.indexOf("Send refused by billing guard:") < sender.indexOf("if (claim.error || !claim.data) continue;"));
check("no secret or key is logged by the new code", !/console\.(log|error)\([^)]*(token|secret|key)/i.test(sender.slice(sender.indexOf("makeEmailStore"))));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll notification email checks passed.");
process.exit(failures ? 1 : 0);
