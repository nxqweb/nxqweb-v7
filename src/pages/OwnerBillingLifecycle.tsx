import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, Clock3, RefreshCcw, Snowflake } from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

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
};

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value || 0);
}

function formatStatus(value: string) {
  return value.replaceAll("_", " ");
}

function formatDate(value: string | null) {
  if (!value) return "Not set";
  return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
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
        "id, business_name, monthly_price, billing_status, billing_provider, billing_overdue_since, billing_frozen_at"
      )
      .order("business_name");

    if (result.error) {
      setError(`Billing clients could not load: ${result.error.message}`);
      setLoading(false);
      return;
    }

    setClients((result.data || []) as ClientRow[]);
    setLoading(false);
  }

  useEffect(() => {
    void loadClients();
  }, []);

  const attentionClients = useMemo(
    () => clients.filter((client) => ["past_due", "freeze_review", "frozen"].includes(client.billing_status)),
    [clients]
  );

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
