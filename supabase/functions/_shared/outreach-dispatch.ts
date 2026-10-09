// Outreach delivery orchestration for NXQX sales email.
// Pure orchestration with injected dependencies: no database client, no environment reads, no
// network except the optional Resend sender whose fetch is injected. Nothing in the repository
// calls this yet; it becomes active only when a thin Edge function is added and deployed through
// the guarded workflow. The database stays the authority: queueing, reservation (switches,
// suppression, business hours, daily cap) and event recording are existing service-role RPCs.
// This layer adds fail-closed checks on top and never sends when any switch is off.

import { evaluateSendEligibility, validateOutreachDraft, type SendSettings } from "./outreach-compliance.ts";

export type DispatchSettings = SendSettings & {
  sender_display_name: string;
  sender_business_name: string;
  email_opt_out_instruction: string;
};

export type DispatchProspect = {
  business_name: string;
  city?: string | null;
  state_region?: string | null;
  country?: string | null;
  contact_email: string;
  status: string;
};

export type DispatchDraft = { id: string; status: string; channel: string; subject: string; body: string };

export type JobContext = {
  job_id: string;
  draft: DispatchDraft;
  prospect: DispatchProspect;
  permission: { status: string; basis: string; revoked_at?: string | null } | null;
  suppressed: boolean;
};

export type OutboundEmail = { from: string; to: string; subject: string; text: string; headers: Record<string, string> };
export type SendResult = { ok: boolean; messageId?: string; error?: string };

export type DispatchDeps = {
  now: () => Date;
  getSettings: () => Promise<DispatchSettings>;
  serverDeliveryEnabled: boolean; // separate server-side switch (an Edge secret in production)
  providerConfigured: boolean;
  countSentToday: () => Promise<number>;
  listApprovedDraftIdsWithoutJob: (limit: number) => Promise<string[]>;
  queueDelivery: (draftId: string, scheduledFor: Date, idempotencyKey: string) => Promise<{ ok: boolean }>;
  listDueJobIds: (limit: number) => Promise<string[]>;
  reserve: (jobId: string, serverDeliveryEnabled: boolean) => Promise<{ ok: boolean; reason?: string }>;
  loadJobContext: (jobId: string) => Promise<JobContext>;
  send: (email: OutboundEmail, idempotencyKey: string) => Promise<SendResult>;
  recordEvent: (jobId: string, eventType: "sent" | "failed", providerMessageId: string | null, error: string | null) => Promise<void>;
};

export type DispatchSummary = {
  ok: boolean;
  held: boolean;
  hold_reasons: string[];
  queued: number;
  sent: number;
  failed: number;
  skipped: number;
  skip_reasons: Record<string, number>;
  stopped_early: string | null;
};

// Plain-text email only. The footer carries sender identity, postal address and the opt-out line;
// the List-Unsubscribe header points at the sender mailbox so mail clients can offer opt-out.
export function buildOutboundEmail(draft: DispatchDraft, prospect: DispatchProspect, settings: DispatchSettings): OutboundEmail {
  const senderEmail = String(settings.sender_email ?? "").trim();
  const footer = [
    "",
    "--",
    settings.sender_business_name,
    String(settings.postal_address ?? "").trim(),
    settings.email_opt_out_instruction,
  ].join("\n");
  return {
    from: `${settings.sender_display_name} <${senderEmail}>`,
    to: prospect.contact_email,
    subject: draft.subject.trim(),
    text: `${draft.body.trim()}\n${footer}\n`,
    headers: { "List-Unsubscribe": `<mailto:${senderEmail}?subject=unsubscribe>` },
  };
}

function count(summary: DispatchSummary, reason: string) {
  summary.skipped += 1;
  summary.skip_reasons[reason] = (summary.skip_reasons[reason] ?? 0) + 1;
}

export async function runOutreachDispatch(deps: DispatchDeps, options: { limit?: number } = {}): Promise<DispatchSummary> {
  const summary: DispatchSummary = { ok: true, held: false, hold_reasons: [], queued: 0, sent: 0, failed: 0, skipped: 0, skip_reasons: {}, stopped_early: null };
  const settings = await deps.getSettings();

  // Hold everything unless every switch is on. Nothing is queued, reserved or sent while held.
  if (settings.emergency_stop) summary.hold_reasons.push("emergency_stop_on");
  if (settings.automation_mode !== "guarded") summary.hold_reasons.push("automation_mode_not_guarded");
  if (!settings.external_delivery_enabled) summary.hold_reasons.push("external_delivery_disabled");
  if (!deps.serverDeliveryEnabled) summary.hold_reasons.push("server_delivery_switch_off");
  if (!deps.providerConfigured) summary.hold_reasons.push("email_provider_not_configured");
  if (summary.hold_reasons.length) {
    summary.held = true;
    return summary;
  }

  const cap = Math.min(Math.max(Number(settings.daily_email_limit) || 0, 0), 50);
  let sentToday = await deps.countSentToday();
  const requested = Math.min(Math.max(Number(options.limit) || 10, 1), 50);

  // 1. Queue approved drafts that have no delivery job yet (the database re-checks every rule).
  const room = Math.max(cap - sentToday, 0);
  if (room === 0) {
    summary.stopped_early = "daily_cap_reached";
    return summary;
  }
  for (const draftId of await deps.listApprovedDraftIdsWithoutJob(Math.min(requested, room))) {
    try {
      const queued = await deps.queueDelivery(draftId, deps.now(), `sales-delivery:${draftId}`);
      if (queued.ok) summary.queued += 1; else count(summary, "queue_refused");
    } catch {
      count(summary, "queue_refused");
    }
  }

  // 2. Reserve and send due jobs, one at a time, stopping at the cap.
  for (const jobId of await deps.listDueJobIds(Math.min(requested, room))) {
    if (sentToday >= cap) {
      summary.stopped_early = "daily_cap_reached";
      break;
    }
    let reservation: { ok: boolean; reason?: string };
    try {
      reservation = await deps.reserve(jobId, deps.serverDeliveryEnabled);
    } catch {
      count(summary, "reserve_error");
      continue;
    }
    if (!reservation.ok) {
      count(summary, reservation.reason || "not_reserved");
      continue;
    }

    // From here the job is reserved. It must end as sent or failed; a crash leaves it reserved,
    // which can never send twice.
    try {
      const context = await deps.loadJobContext(jobId);
      const check = validateOutreachDraft(context.draft, { allowedLiterals: [context.prospect.business_name, context.prospect.city ?? ""] });
      const eligibility = evaluateSendEligibility({
        settings,
        draft: { status: context.draft.status, channel: context.draft.channel },
        permission: context.permission,
        suppressed: context.suppressed,
        doNotContact: context.prospect.status === "do_not_contact",
        sentToday,
        now: deps.now(),
        region: { country: context.prospect.country ?? null, stateRegion: context.prospect.state_region ?? null },
      });
      if (!check.ok || !eligibility.allowed) {
        const reasons = [...check.reasons, ...eligibility.reasons].slice(0, 6).join(",");
        await deps.recordEvent(jobId, "failed", null, `compliance_hold:${reasons}`.slice(0, 300));
        summary.failed += 1;
        continue;
      }
      let result: SendResult;
      try {
        result = await deps.send(buildOutboundEmail(context.draft, context.prospect, settings), `sales-send:${jobId}`);
      } catch (error) {
        result = { ok: false, error: error instanceof Error ? error.message : "send_failed" };
      }
      if (result.ok) {
        await deps.recordEvent(jobId, "sent", result.messageId ?? null, null);
        summary.sent += 1;
        sentToday += 1;
      } else {
        await deps.recordEvent(jobId, "failed", null, String(result.error ?? "send_failed").slice(0, 300));
        summary.failed += 1;
      }
    } catch {
      // Could not even record the outcome: stop the whole run rather than risk repeats.
      summary.ok = false;
      summary.stopped_early = "record_event_error";
      break;
    }
  }
  return summary;
}

// Resend sender. The host is a fixed literal, redirects are refused, and the response body is
// never echoed back beyond a short status string. `fetchImpl` is injected for tests.
export function createResendSender(apiKey: string, fetchImpl: typeof fetch = fetch, timeoutMs = 15_000) {
  return async (email: OutboundEmail, idempotencyKey: string): Promise<SendResult> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        redirect: "error",
        signal: controller.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}`, "Idempotency-Key": idempotencyKey.slice(0, 256) },
        body: JSON.stringify({ from: email.from, to: [email.to], subject: email.subject, text: email.text, headers: email.headers }),
      });
      const raw = await response.text();
      if (!response.ok) return { ok: false, error: `email_provider_http_${response.status}` };
      let parsed: { id?: unknown } = {};
      try { parsed = raw ? JSON.parse(raw) : {}; } catch { return { ok: false, error: "email_provider_invalid_json" }; }
      return typeof parsed.id === "string" && parsed.id ? { ok: true, messageId: parsed.id.slice(0, 180) } : { ok: false, error: "email_provider_no_message_id" };
    } catch (error) {
      return { ok: false, error: error instanceof DOMException && error.name === "AbortError" ? "email_provider_timeout" : "email_provider_unreachable" };
    } finally {
      clearTimeout(timer);
    }
  };
}
