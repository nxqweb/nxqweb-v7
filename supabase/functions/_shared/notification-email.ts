// Email recipient resolution and email-copy creation for notifications. Pure logic: every database call goes through an injected store, so this runs
// the same in the Edge function and in the Node tests.
//
// Why this exists: the notification sender (dispatch-notifications -> notification-provider-adapter -> Resend) needs the recipient's email address on every
// email-channel delivery, but nothing ever filled `recipient_reference`, and almost every notification is created in-app only. This module (1) turns a chosen,
// conservative set of in-app notifications into email copies with the address filled in, and (2) resolves the address for email rows that have none (digests).
//
// Hard rules kept here: nothing is emailed unless the owner switched it on (NXQ_EMAIL_NOTIFICATIONS_ENABLED=true); never for QA-only clients; an address must look
// like a real address; preferences (email off, quiet hours, digests) are still applied afterwards by notification_delivery_decision before anything is sent.

export type DeliveryRow = {
  id: string;
  client_id: string | null;
  project_id?: string | null;
  channel: string;
  recipient_kind: string;
  recipient_reference?: string | null;
  template_key: string;
  subject: string | null;
  body: string;
  priority: string;
  metadata?: Record<string, unknown> | null;
};

export type ClientContact = { contact_email: string | null; qa_only: boolean | null; status: string | null };

export type EmailDeliveryInsert = {
  client_id: string | null;
  project_id: string | null;
  channel: "email";
  recipient_kind: string;
  recipient_reference: string;
  template_key: string;
  subject: string | null;
  body: string;
  priority: string;
  metadata: Record<string, unknown>;
};

export type EmailStore = {
  getClient: (clientId: string) => Promise<ClientContact | null>;
  listOwnerEmails: () => Promise<string[]>;
  hasEmailCopy: (sourceDeliveryId: string, recipient: string) => Promise<boolean>;
  insertEmailDelivery: (row: EmailDeliveryInsert) => Promise<void>;
};

// Conservative on purpose: money events, a file that was held back, a customer request, and the owner alerts that need a human.
// Extend this list deliberately; everything else stays in-app. business_setup_denied is NOT here: the database paid-capability guard (migration 246) refuses
// every external send for a client that is not approved with active billing, and a denied client never is, so that email could never be sent.
export const CLIENT_EMAIL_TEMPLATES: ReadonlySet<string> = new Set([
  "billing_payment_succeeded",
  "billing_payment_failed",
  "billing_past_due_reminder",
  "client_file_quarantined",
  "new_commerce_request",
]);

export const OWNER_EMAIL_TEMPLATES: ReadonlySet<string> = new Set([
  "billing_freeze_review_owner_attention",
  "billing_processor_connection_required",
]);

export const MAX_OWNER_RECIPIENTS = 5;
const BLOCKED_CLIENT_STATUSES: ReadonlySet<string> = new Set(["archived", "dormant"]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isDeliverableEmail(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const email = value.trim();
  if (email.length < 6 || email.length > 254 || !EMAIL_PATTERN.test(email)) return false;
  // Reserved test domains can never receive mail; QA fixtures use them.
  const domain = email.split("@")[1].toLowerCase();
  return !(domain === "invalid" || domain.endsWith(".invalid") || domain === "example.com" || domain === "example.org" || domain === "example.net");
}

export function emailNotificationsEnabled(value: string | undefined | null): boolean {
  return String(value ?? "").trim().toLowerCase() === "true";
}

export type SiblingResult = { created: number; skipped: string | null };

// Creates the email copy (or copies, one per owner) of an in-app delivery. Safe to call twice: an existing copy for the same recipient is never duplicated.
export async function ensureEmailCopies(store: EmailStore, source: DeliveryRow, enabled: boolean): Promise<SiblingResult> {
  if (!enabled) return { created: 0, skipped: "email_notifications_off" };
  if (source.channel !== "in_app") return { created: 0, skipped: "not_in_app" };

  let recipients: string[];
  if (source.recipient_kind === "client") {
    if (!CLIENT_EMAIL_TEMPLATES.has(source.template_key)) return { created: 0, skipped: "template_not_emailed" };
    if (!source.client_id) return { created: 0, skipped: "no_client" };
    const client = await store.getClient(source.client_id);
    if (!client) return { created: 0, skipped: "client_not_found" };
    if (client.qa_only) return { created: 0, skipped: "qa_only_client" };
    if (client.status && BLOCKED_CLIENT_STATUSES.has(client.status)) return { created: 0, skipped: "client_status_blocked" };
    if (!isDeliverableEmail(client.contact_email)) return { created: 0, skipped: "no_deliverable_client_email" };
    recipients = [client.contact_email.trim().toLowerCase()];
  } else if (source.recipient_kind === "owner") {
    if (!OWNER_EMAIL_TEMPLATES.has(source.template_key)) return { created: 0, skipped: "template_not_emailed" };
    if (source.client_id) {
      // An owner alert about a QA-only client stays in-app, exactly like client mail.
      const client = await store.getClient(source.client_id);
      if (client?.qa_only) return { created: 0, skipped: "qa_only_client" };
    }
    const owners = (await store.listOwnerEmails()).filter(isDeliverableEmail).map((e) => e.trim().toLowerCase());
    recipients = [...new Set(owners)].slice(0, MAX_OWNER_RECIPIENTS);
    if (recipients.length === 0) return { created: 0, skipped: "no_deliverable_owner_email" };
  } else {
    return { created: 0, skipped: "recipient_kind_not_emailed" };
  }

  let created = 0;
  for (const recipient of recipients) {
    if (await store.hasEmailCopy(source.id, recipient)) continue;
    await store.insertEmailDelivery({
      client_id: source.client_id,
      project_id: source.project_id ?? null,
      channel: "email",
      recipient_kind: source.recipient_kind,
      recipient_reference: recipient,
      template_key: source.template_key,
      subject: source.subject,
      body: source.body,
      priority: source.priority,
      metadata: { email_of_delivery_id: source.id, email_copy: true },
    });
    created += 1;
  }
  return { created, skipped: null };
}

export type RecipientResult = { email: string; reason?: undefined } | { email: null; reason: string };

// For an email-channel row about to be sent: use its own address when valid; otherwise (digests) fall back to the client's contact email.
export async function resolveRecipientEmail(store: EmailStore, delivery: DeliveryRow): Promise<RecipientResult> {
  if (isDeliverableEmail(delivery.recipient_reference)) return { email: delivery.recipient_reference.trim().toLowerCase() };
  if (delivery.recipient_kind === "client" && delivery.client_id) {
    const client = await store.getClient(delivery.client_id);
    if (!client) return { email: null, reason: "client_not_found" };
    if (client.qa_only) return { email: null, reason: "qa_only_client" };
    if (!isDeliverableEmail(client.contact_email)) return { email: null, reason: "no_deliverable_client_email" };
    return { email: client.contact_email.trim().toLowerCase() };
  }
  return { email: null, reason: "no_recipient_address" };
}
