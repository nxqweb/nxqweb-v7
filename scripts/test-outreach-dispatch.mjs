// Offline tests for outreach delivery orchestration using in-memory fakes. No network, no database,
// no secrets, and no email is ever sent.
import { buildOutboundEmail, createResendSender, runOutreachDispatch } from "../supabase/functions/_shared/outreach-dispatch.ts";

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`PASS  ${name}`);
  else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); }
}

const settings = {
  automation_mode: "guarded", emergency_stop: false, external_delivery_enabled: true, daily_email_limit: 3,
  business_timezone: "America/Los_Angeles", send_window_start: "09:00", send_window_end: "16:30",
  sender_email: "christian@send.example.test", postal_address: "1 Main St, Austin TX 78701",
  sender_display_name: "Christian at NXQ Web", sender_business_name: "NXQ Web",
  email_opt_out_instruction: "Reply unsubscribe and I will not contact you again.",
};
const NOW = new Date("2026-10-07T17:00:00Z"); // Wednesday 10:00 in Los Angeles
const goodBody = "Hi Acme Tree team,\n\nI reviewed the public information available for your business in Austin. The contact page is hard to find on a phone.\n\nNXQ-Web builds and manages small-business websites. Would you like a short plan based only on facts you approve?";

function makeWorld(overrides = {}) {
  const world = {
    settings: { ...settings, ...(overrides.settings || {}) },
    jobs: overrides.jobs ?? ["j1", "j2"],
    approvedDrafts: overrides.approvedDrafts ?? ["d1"],
    reserveResult: overrides.reserveResult ?? (() => ({ ok: true })),
    context: overrides.context ?? ((jobId) => ({
      job_id: jobId,
      draft: { id: `d-${jobId}`, status: "approved", channel: "email", subject: "A website idea for Acme Tree", body: goodBody },
      prospect: { business_name: "Acme Tree", city: "Austin", state_region: "TX", country: "US", contact_email: `owner-${jobId}@prospect.example.test`, status: "contacted" },
      permission: { status: "allowed", basis: "public_business_email", revoked_at: null },
      suppressed: false,
    })),
    sendResult: overrides.sendResult ?? (() => ({ ok: true, messageId: "msg_1" })),
    sentToday: overrides.sentToday ?? 0,
    calls: { queue: [], reserve: [], send: [], events: [] },
    failRecord: overrides.failRecord ?? false,
  };
  const deps = {
    now: () => NOW,
    getSettings: async () => world.settings,
    serverDeliveryEnabled: overrides.serverDeliveryEnabled ?? true,
    providerConfigured: overrides.providerConfigured ?? true,
    countSentToday: async () => world.sentToday,
    listApprovedDraftIdsWithoutJob: async () => world.approvedDrafts,
    queueDelivery: async (id, when, key) => { world.calls.queue.push({ id, key }); return { ok: true }; },
    listDueJobIds: async () => world.jobs,
    reserve: async (id, enabled) => { world.calls.reserve.push({ id, enabled }); return world.reserveResult(id); },
    loadJobContext: async (id) => world.context(id),
    send: async (email, key) => { world.calls.send.push({ email, key }); return world.sendResult(email); },
    recordEvent: async (id, type, msg, err) => { if (world.failRecord) throw new Error("db down"); world.calls.events.push({ id, type, msg, err }); },
  };
  return { world, deps };
}

// 1. Every switch holds everything: nothing queued, reserved or sent.
for (const [label, ov, reason] of [
  ["emergency stop", { settings: { emergency_stop: true } }, "emergency_stop_on"],
  ["review-only mode", { settings: { automation_mode: "review_only" } }, "automation_mode_not_guarded"],
  ["database delivery switch off", { settings: { external_delivery_enabled: false } }, "external_delivery_disabled"],
  ["server delivery switch off", { serverDeliveryEnabled: false }, "server_delivery_switch_off"],
  ["email provider not configured", { providerConfigured: false }, "email_provider_not_configured"],
]) {
  const { world, deps } = makeWorld(ov);
  const summary = await runOutreachDispatch(deps);
  check(`held when ${label}`, summary.held && summary.hold_reasons.includes(reason) && !world.calls.queue.length && !world.calls.reserve.length && !world.calls.send.length && !world.calls.events.length);
}
{
  const { world, deps } = makeWorld({ settings: { emergency_stop: true, automation_mode: "review_only", external_delivery_enabled: false }, serverDeliveryEnabled: false, providerConfigured: false });
  const summary = await runOutreachDispatch(deps);
  check("the shipped defaults hold with all five reasons", summary.hold_reasons.length === 5 && world.calls.send.length === 0);
}

// 2. Happy path.
{
  const { world, deps } = makeWorld();
  const summary = await runOutreachDispatch(deps, { limit: 10 });
  check("approved drafts are queued with a deterministic idempotency key", world.calls.queue.length === 1 && world.calls.queue[0].key === "sales-delivery:d1");
  check("each due job is reserved with the server switch on", world.calls.reserve.length === 2 && world.calls.reserve.every((c) => c.enabled === true));
  check("two compliant jobs are sent and recorded as sent", summary.sent === 2 && world.calls.send.length === 2 && world.calls.events.filter((e) => e.type === "sent").length === 2 && summary.ok);
  const email = world.calls.send[0].email;
  check("email is plain text with sender identity, postal address and opt-out line",
    email.text.includes("NXQ Web") && email.text.includes("1 Main St, Austin TX 78701") && email.text.includes("Reply unsubscribe") && !/<[a-z]/i.test(email.text));
  check("email carries a List-Unsubscribe header and the configured sender", email.headers["List-Unsubscribe"].includes("christian@send.example.test") && email.from.startsWith("Christian at NXQ Web <"));
  check("send idempotency key is per job", world.calls.send[0].key === "sales-send:j1" && world.calls.send[1].key === "sales-send:j2");
  check("the summary carries no email addresses", !JSON.stringify(summary).includes("@"));
}

// 3. Daily cap, including mid-run.
{
  const { world, deps } = makeWorld({ sentToday: 3 });
  const summary = await runOutreachDispatch(deps);
  check("nothing is queued or sent when the cap is already reached", summary.stopped_early === "daily_cap_reached" && !world.calls.queue.length && !world.calls.send.length);
}
{
  const { world, deps } = makeWorld({ jobs: ["j1", "j2", "j3"], sentToday: 2 });
  const summary = await runOutreachDispatch(deps);
  check("the run stops mid-way when the cap is reached", summary.sent === 1 && world.calls.send.length === 1);
}
{
  const { world, deps } = makeWorld({ settings: { daily_email_limit: 500 }, jobs: Array.from({ length: 60 }, (_, i) => `j${i}`), sentToday: 0 });
  await runOutreachDispatch(deps, { limit: 500 });
  check("the cap can never exceed 50", world.calls.send.length <= 50);
}

// 4. Database reservation refusals and defence in depth.
{
  const { world, deps } = makeWorld({ reserveResult: () => ({ ok: false, reason: "recipient_suppressed" }) });
  const summary = await runOutreachDispatch(deps);
  check("a refused reservation is never sent", summary.skipped === 2 && summary.skip_reasons.recipient_suppressed === 2 && !world.calls.send.length);
}
{
  const { world, deps } = makeWorld({ context: (id) => ({ ...makeWorld().world.context(id), suppressed: true }) });
  const summary = await runOutreachDispatch(deps);
  check("a suppressed recipient that slipped past is stopped here and recorded failed", summary.failed === 2 && !world.calls.send.length && world.calls.events.every((e) => e.type === "failed" && e.err.startsWith("compliance_hold:")));
}
{
  const { world, deps } = makeWorld({ context: (id) => { const c = makeWorld().world.context(id); c.draft.body = `${goodBody} We guarantee first page of Google. See https://x.example.test`; return c; } });
  const summary = await runOutreachDispatch(deps);
  check("a non-compliant draft is stopped here and never sent", summary.failed === 2 && !world.calls.send.length);
}
{
  const { world, deps } = makeWorld({ context: (id) => { const c = makeWorld().world.context(id); c.prospect.country = "GB"; return c; } });
  const summary = await runOutreachDispatch(deps);
  check("a non-US recipient is stopped here", summary.failed === 2 && !world.calls.send.length);
}
{
  const { world, deps } = makeWorld({ context: (id) => { const c = makeWorld().world.context(id); c.draft.channel = "sms"; return c; } });
  const summary = await runOutreachDispatch(deps);
  check("sms is never sent", summary.failed === 2 && !world.calls.send.length);
}

// 5. Failures are recorded and never retried inside the run.
{
  const { world, deps } = makeWorld({ sendResult: () => ({ ok: false, error: "email_provider_http_500" }) });
  const summary = await runOutreachDispatch(deps);
  check("provider failures are recorded as failed and not resent", summary.failed === 2 && world.calls.send.length === 2 && world.calls.events.every((e) => e.type === "failed"));
}
{
  const { world, deps } = makeWorld({ sendResult: () => { throw new Error("boom"); } });
  const summary = await runOutreachDispatch(deps);
  check("a throwing sender is contained and recorded failed", summary.failed === 2 && summary.ok === true && world.calls.events.length === 2);
}
{
  const { world, deps } = makeWorld({ failRecord: true });
  const summary = await runOutreachDispatch(deps);
  check("if the outcome cannot be recorded the run stops after one send attempt", summary.ok === false && summary.stopped_early === "record_event_error" && world.calls.send.length === 1);
}

// 6. Resend sender with an injected fetch.
{
  const seen = [];
  const sender = createResendSender("TEST_KEY_NOT_REAL", async (url, init) => { seen.push({ url, init }); return new Response(JSON.stringify({ id: "re_123" }), { status: 200 }); });
  const email = buildOutboundEmail({ id: "d", status: "approved", channel: "email", subject: "A website idea for Acme", body: goodBody }, { business_name: "Acme", contact_email: "x@prospect.example.test", status: "contacted" }, settings);
  const result = await sender(email, "sales-send:abc");
  const body = JSON.parse(seen[0].init.body);
  check("Resend request goes to the fixed host with auth, idempotency key and no redirects",
    seen[0].url === "https://api.resend.com/emails" && seen[0].init.redirect === "error" && seen[0].init.headers.Authorization === "Bearer TEST_KEY_NOT_REAL" && seen[0].init.headers["Idempotency-Key"] === "sales-send:abc");
  check("Resend body is plain text with one recipient", Array.isArray(body.to) && body.to.length === 1 && typeof body.text === "string" && !("html" in body));
  check("a message id is returned on success", result.ok && result.messageId === "re_123");
  const failing = createResendSender("K", async () => new Response("{}", { status: 422 }));
  check("HTTP errors map to a short status code without the body", (await failing(email, "k")).error === "email_provider_http_422");
  const unreachable = createResendSender("K", async () => { throw new TypeError("network"); });
  check("network errors map to a short code", (await unreachable(email, "k")).error === "email_provider_unreachable");
  const noId = createResendSender("K", async () => new Response("{}", { status: 200 }));
  check("a success without a message id is treated as failure", (await noId(email, "k")).ok === false);
}

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll outreach-dispatch checks passed (offline fakes only; no email was sent and none can be sent by this test).");
process.exit(failures ? 1 : 0);
