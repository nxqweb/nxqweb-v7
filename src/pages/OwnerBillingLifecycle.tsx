import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, Clock3, RefreshCcw, Snowflake } from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";
import { formatStatus, formatUsd as formatMoney } from "../lib/format";
import { OwnerStripeCustomerLinks } from "../components/OwnerStripeCustomerLinks";

type BillingStatus =
  | "not_configured"
  | "activation_pending"
  | "active"
  | "past_due"
  | "freeze_review"
  | "frozen"
  | "cancelled";

type ClientRow = {
  id: string;
  business_name: string;
  monthly_price: number;
  billing_status: BillingStatus;
  billing_provider: string | null;
  billing_overdue_since: string | null;
  billing_frozen_at: string | null;
  status: string;
  qa_only: boolean | null;
};

function formatDate(value: string | null) {
  if (!value) return "Not set";
  return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

type LocationAddonClientRow = {
  client_id: string;
  business_name: string;
  tier_key: string | null;
  base_price_cents: number;
  enabled_units: number;
  addon_amount_cents: number;
  internal_total_cents: number;
  active_location_count: number;
  effective_cap: number;
};

type LocationOverEntitlementRow = {
  client_id: string;
  business_name: string;
  tier_key: string | null;
  active_location_count: number;
  effective_cap: number;
};

type BillingNotificationRow = {
  id: string;
  client_id: string | null;
  template_key: string;
  subject: string | null;
  body: string;
  priority: string;
  status: string;
  created_at: string;
};

type LocationAddonEventRow = {
  client_id: string;
  business_name: string;
  event_type: "enabled" | "cancelled";
  resulting_enabled_units: number;
  billing_live_at_event: boolean;
  occurred_at: string;
};

function formatCentsMoney(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((cents || 0) / 100);
}

function graceLabel(value: string | null) {
  if (!value) return "Grace clock unavailable";
  const elapsedDays = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000));
  const remainingDays = Math.max(0, 14 - elapsedDays);
  return remainingDays > 0
    ? `${remainingDays} grace day${remainingDays === 1 ? "" : "s"} remaining`
    : `Grace period ended ${Math.max(0, elapsedDays - 14)} day${elapsedDays - 14 === 1 ? "" : "s"} ago`;
}

export function OwnerBillingLifecycle() {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [workingClientId, setWorkingClientId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [addonClients, setAddonClients] = useState<LocationAddonClientRow[]>([]);
  const [overEntitlement, setOverEntitlement] = useState<LocationOverEntitlementRow[]>([]);
  const [addonEvents, setAddonEvents] = useState<LocationAddonEventRow[]>([]);
  const [billingNotifications, setBillingNotifications] = useState<BillingNotificationRow[]>([]);

  async function loadClients() {
    setLoading(true);
    setError("");

    if (!isSupabaseConfigured || !supabase) {
      setError("Supabase is not configured yet.");
      setLoading(false);
      return;
    }

    const result = await supabase
      .from("clients")
      .select(
        "id, business_name, monthly_price, billing_status, billing_provider, billing_overdue_since, billing_frozen_at, status, qa_only"
      )
      .order("business_name");

    if (result.error) {
      setError(`Billing clients could not load: ${result.error.message}`);
      setLoading(false);
      return;
    }

    setClients((result.data || []) as ClientRow[]);

    const addonResult = await supabase.rpc("owner_location_addon_overview");
    if (!addonResult.error && addonResult.data) {
      const data = addonResult.data as {
        clients?: LocationAddonClientRow[];
        over_entitlement?: LocationOverEntitlementRow[];
        recent_events?: LocationAddonEventRow[];
      };
      setAddonClients(data.clients || []);
      setOverEntitlement(data.over_entitlement || []);
      setAddonEvents(data.recent_events || []);
    }

    const notificationsResult = await supabase
      .from("notification_deliveries")
      .select("id, client_id, template_key, subject, body, priority, status, created_at")
      .eq("recipient_kind", "owner")
      .like("template_key", "billing_%")
      .order("created_at", { ascending: false })
      .limit(20);
    if (!notificationsResult.error) {
      setBillingNotifications((notificationsResult.data || []) as BillingNotificationRow[]);
    }

    setLoading(false);
  }

  useEffect(() => {
    void loadClients();
  }, []);

  const attentionClients = useMemo(
    () => clients.filter((client) => ["past_due", "freeze_review", "frozen"].includes(client.billing_status)),
    [clients]
  );

  // TEMPORARY-TEST-ACTIVATION: clients that could be switched to Active by hand for testing. Remove with the section below.
  const testActivationClients = useMemo(
    () => clients.filter((client) => ["not_configured", "activation_pending"].includes(client.billing_status)),
    [clients]
  );

  const clientNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const client of clients) map.set(client.id, client.business_name);
    return map;
  }, [clients]);

  async function changeBillingState(
    client: ClientRow,
    nextStatus: "past_due" | "freeze_review" | "frozen" | "active"
  ) {
    if (!supabase) return;

    const confirmed = window.confirm(
      [
        `Change billing to ${formatStatus(nextStatus)}?`,
        "",
        `Client: ${client.business_name}`,
        `Current: ${formatStatus(client.billing_status)}`,
        `Next: ${formatStatus(nextStatus)}`,
        "",
        "This changes billing only. It does not charge money and does not change the project stage.",
      ].join("\n")
    );

    if (!confirmed) return;

    const note = window.prompt(
      nextStatus === "frozen" ? "Required freeze reason (at least 8 characters):" : "Optional owner billing note:",
      ""
    ) ?? null;
    if (note === null) return;
    if (nextStatus === "frozen" && note.trim().length < 8) {
      setError("Add a specific freeze reason of at least 8 characters.");
      return;
    }

    setWorkingClientId(client.id);
    setNotice("");
    setError("");

    const result = await supabase.rpc("owner_set_client_billing_state", {
      target_client_id: client.id,
      next_billing_status: nextStatus,
      next_billing_provider: client.billing_provider || "manual",
      billing_note: note.trim() || null,
    });

    setWorkingClientId(null);

    if (result.error) {
      setError(`Billing change failed: ${result.error.message}`);
      return;
    }

    const data = result.data as { message?: string } | null;
    setNotice(data?.message || `${client.business_name} billing updated.`);
    await loadClients();
  }

  async function recordPayment(client: ClientRow) {
    if (!supabase) return;

    const amountInput = window.prompt(
      `Record manual payment for ${client.business_name}.\n\nNo card or bank account will be charged.`,
      String(Number(client.monthly_price || 0))
    );

    if (amountInput === null) return;

    const amount = Number(amountInput);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Enter a valid payment amount greater than zero.");
      return;
    }

    const note = window.prompt(
      "Payment note:",
      "Manual payment received. No online charge was processed."
    );

    if (note === null) return;

    const confirmed = window.confirm(
      `Record ${formatMoney(amount)} as received and restore billing to active?\n\nThis records a manual payment only. It does not process a real charge.`
    );

    if (!confirmed) return;

    setWorkingClientId(client.id);
    setNotice("");
    setError("");

    const result = await supabase.rpc("record_manual_payment_and_restore", {
      target_client_id: client.id,
      payment_amount: amount,
      payment_note: note.trim() || null,
    });

    setWorkingClientId(null);

    if (result.error) {
      setError(`Payment record failed: ${result.error.message}`);
      return;
    }

    const data = result.data as { message?: string } | null;
    setNotice(data?.message || `${client.business_name} payment recorded and billing restored.`);
    await loadClients();
  }

  return (
    <main className="nxq-page">
      <section className="portal-shell">
        <div className="panel-title panel-title-row">
          <div className="panel-title">
            <Clock3 size={22} />
            <div>
              <h1>Billing lifecycle</h1>
              <p className="subtle">Review overdue accounts, confirm freezes, and record manual payments safely.</p>
            </div>
          </div>

          <div className="client-control-row">
            <a className="icon-btn" href="/owner"><ArrowLeft size={16} /> Owner portal</a>
            <button className="icon-btn" onClick={() => void loadClients()} type="button">
              <RefreshCcw size={16} /> Refresh
            </button>
          </div>
        </div>

        {error ? <div className="notice-card error" role="alert">{error}</div> : null}
        {notice ? <div className="notice-card success" role="status">{notice}</div> : null}

        <div className="portal-grid">
          <section className="panel"><Clock3 size={20} /><h2>{attentionClients.length}</h2><p className="subtle">Accounts needing review</p></section>
          <section className="panel"><Snowflake size={20} /><h2>{clients.filter((client) => client.billing_status === "freeze_review").length}</h2><p className="subtle">Human freeze decisions</p></section>
          <section className="panel"><CheckCircle2 size={20} /><h2>{clients.filter((client) => client.billing_status === "active").length}</h2><p className="subtle">Active accounts</p></section>
        </div>

        {/* TEMPORARY-TEST-ACTIVATION (start): owner-requested test helper. REMOVE this whole section, testActivationClients above, and
            scripts/test-temp-owner-activation.mjs when testing is finished. See docs/LAUNCH_HARDENING_CHECKLIST.md. */}
        {!loading && testActivationClients.length > 0 ? (
          <section className="panel panel-wide" aria-label="Temporary test activation">
            <div className="panel-title">
              <CheckCircle2 size={20} />
              <div>
                <h2>Temporary: activate a test client (no charge)</h2>
                <p className="subtle">
                  For testing only. This switches billing to Active without charging anything, so a test client can upload files and use paid features.
                  It does not approve the client, and it never works on QA-only clients. Remove this section when testing is finished.
                </p>
              </div>
            </div>
            <div className="owner-message-list">
              {testActivationClients.map((client) => {
                const approved = ["approved", "active", "overdue"].includes(client.status);
                return (
                  <article className="owner-message-card" key={client.id}>
                    <div className="owner-message-top">
                      <strong>{client.business_name}</strong>
                      <span>Billing: {formatStatus(client.billing_status)}</span>
                    </div>
                    <p className="subtle">Client status: {formatStatus(client.status)}</p>
                    {client.qa_only ? (
                      <p className="subtle">QA-only client: permanently non-billable, so it cannot be activated and cannot upload files. Use a normal test client.</p>
                    ) : (
                      <>
                        {!approved ? <p className="subtle">Uploads also need this client to be approved first (approve it in the owner portal). Activating billing alone is not enough.</p> : null}
                        <button className="wide-btn" disabled={workingClientId === client.id} onClick={() => void changeBillingState(client, "active")} type="button">
                          {workingClientId === client.id ? "Updating…" : "Activate billing (no charge)"}
                        </button>
                      </>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}
        {/* TEMPORARY-TEST-ACTIVATION (end) */}

        {!loading ? <OwnerStripeCustomerLinks clients={clients} /> : null}

        <section className="panel panel-wide">
          <div className="panel-title">
            <Snowflake size={20} />
            <div>
              <h2>Needs billing attention</h2>
              <p className="subtle">The 14-day job moves eligible past-due accounts into freeze review. It never freezes automatically.</p>
            </div>
          </div>

          {loading ? <div className="empty-state">Loading billing accounts...</div> : null}
          {!loading && attentionClients.length === 0 ? (
            <div className="empty-state">No clients currently need billing attention.</div>
          ) : null}

          <div className="owner-message-list">
            {attentionClients.map((client) => (
              <article className="owner-message-card" key={client.id}>
                <div className="owner-message-top">
                  <strong>{client.business_name}</strong>
                  <span>{formatStatus(client.billing_status)}</span>
                </div>

                <p>{formatMoney(Number(client.monthly_price || 0))}/month · {client.billing_provider || "manual"}</p>
                <small>
                  Overdue since: {formatDate(client.billing_overdue_since)} · {graceLabel(client.billing_overdue_since)} · Frozen at: {formatDate(client.billing_frozen_at)}
                </small>

                <div className="project-stage-row">
                  {client.billing_status === "past_due" ? (
                    <button disabled={workingClientId === client.id} onClick={() => void changeBillingState(client, "freeze_review")} type="button">
                      {workingClientId === client.id ? "Updating…" : "Send to Freeze Review"}
                    </button>
                  ) : null}

                  {client.billing_status === "freeze_review" ? (
                    <button disabled={workingClientId === client.id} onClick={() => void changeBillingState(client, "frozen")} type="button">
                      {workingClientId === client.id ? "Updating…" : "Confirm Human Freeze"}
                    </button>
                  ) : null}

                  <button disabled={workingClientId === client.id} onClick={() => void recordPayment(client)} type="button">
                    {workingClientId === client.id ? "Recording…" : "Record Payment + Restore"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>

        {overEntitlement.length > 0 ? (
          <section className="panel panel-wide">
            <div className="panel-title">
              <Snowflake size={20} />
              <div>
                <h2>Over entitlement</h2>
                <p className="subtle">These accounts have more active locations than their plan allows (e.g. a downgrade left them over cap). NXQX never closes a location automatically -- this is visibility only.</p>
              </div>
            </div>
            <div className="owner-message-list">
              {overEntitlement.map((row) => (
                <article className="owner-message-card" key={row.client_id}>
                  <div className="owner-message-top">
                    <strong>{row.business_name}</strong>
                    <span>{row.tier_key || "unknown"}</span>
                  </div>
                  <p>{row.active_location_count} active locations, plan allows {row.effective_cap}.</p>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {addonClients.length > 0 ? (
          <section className="panel panel-wide">
            <div className="panel-title">
              <CheckCircle2 size={20} />
              <div>
                <h2>Location add-ons</h2>
                <p className="subtle">Self-serve location add-ons, base plan, and internal total per client. These are not charges -- while billing is off, nothing here is billed.</p>
              </div>
            </div>
            <div className="owner-message-list">
              {addonClients.map((row) => (
                <article className="owner-message-card" key={row.client_id}>
                  <div className="owner-message-top">
                    <strong>{row.business_name}</strong>
                    <span>{row.tier_key || "unknown"}</span>
                  </div>
                  <p>
                    Base {formatCentsMoney(row.base_price_cents)} + Add-ons {formatCentsMoney(row.addon_amount_cents)} ({row.enabled_units} unit{row.enabled_units === 1 ? "" : "s"}) = Internal total {formatCentsMoney(row.internal_total_cents)}
                  </p>
                  <small>{row.active_location_count} of {row.effective_cap} locations in use.</small>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {addonEvents.length > 0 ? (
          <section className="panel panel-wide">
            <div className="panel-title">
              <Clock3 size={20} />
              <div>
                <h2>Recent location add-on activity</h2>
                <p className="subtle">Last {addonEvents.length} self-serve enable/cancel events, most recent first.</p>
              </div>
            </div>
            <div className="owner-message-list">
              {addonEvents.map((event, index) => (
                <article className="owner-message-card" key={`${event.client_id}-${event.occurred_at}-${index}`}>
                  <div className="owner-message-top">
                    <strong>{event.business_name}</strong>
                    <span>{event.event_type}</span>
                  </div>
                  <small>
                    Now {event.resulting_enabled_units} unit{event.resulting_enabled_units === 1 ? "" : "s"} · {formatDate(event.occurred_at)}{event.billing_live_at_event ? " · billing was live at this event" : ""}
                  </small>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {billingNotifications.length > 0 ? (
          <section className="panel panel-wide">
            <div className="panel-title">
              <Snowflake size={20} />
              <div>
                <h2>Billing notifications needing your attention</h2>
                <p className="subtle">Processor-connection and freeze-review events NXQX recorded for you, most recent first. These never charge or freeze anything by themselves.</p>
              </div>
            </div>
            <div className="owner-message-list">
              {billingNotifications.map((notification) => (
                <article className="owner-message-card" key={notification.id}>
                  <div className="owner-message-top">
                    <strong>{(notification.client_id && clientNameById.get(notification.client_id)) || "Unknown client"}</strong>
                    <span>{notification.status}</span>
                  </div>
                  <p>{notification.subject || notification.body}</p>
                  <small>{formatDate(notification.created_at)}</small>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        <section className="panel panel-wide">
          <div className="panel-title">
            <CheckCircle2 size={20} />
            <div>
              <h2>All billing accounts</h2>
              <p className="subtle">Use this list to begin the overdue flow or confirm an account returned to active.</p>
            </div>
          </div>

          <div className="owner-message-list">
            {clients.map((client) => (
              <article className="owner-message-card" key={client.id}>
                <div className="owner-message-top">
                  <strong>{client.business_name}</strong>
                  <span>{formatStatus(client.billing_status)}</span>
                </div>
                <p>{formatMoney(Number(client.monthly_price || 0))}/month</p>

                {client.billing_status === "active" ? (
                  <button disabled={workingClientId === client.id} className="wide-btn" onClick={() => void changeBillingState(client, "past_due")} type="button">
                    Mark Past Due
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}
