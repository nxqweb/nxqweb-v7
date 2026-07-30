import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, Clock3, MessageCircle, Snowflake } from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

type ClientBillingRow = {
  business_name: string;
  billing_status: string;
  billing_provider: string | null;
  billing_due_at: string | null;
  billing_overdue_since: string | null;
  billing_frozen_at: string | null;
  monthly_price: number;
};

function formatStatus(value: string) {
  return value.replaceAll("_", " ");
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value || 0);
}

function formatDate(value: string | null) {
  if (!value) return "Not set";
  return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

export function ClientBillingStatus() {
  const [client, setClient] = useState<ClientBillingRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadBilling() {
    setLoading(true);
    setError("");

    if (!isSupabaseConfigured || !supabase) {
      setError("Billing status is unavailable because Supabase is not configured.");
      setLoading(false);
      return;
    }

    const sessionResult = await supabase.auth.getSession();
    const session = sessionResult.data.session;

    if (!session) {
      window.location.replace("/portal/login");
      return;
    }

    const result = await supabase
      .from("clients")
      .select(
        "business_name, billing_status, billing_provider, billing_due_at, billing_overdue_since, billing_frozen_at, monthly_price"
      )
      .eq("auth_user_id", session.user.id)
      .maybeSingle();

    if (result.error || !result.data) {
      setError(result.error?.message || "No client billing profile was found.");
      setLoading(false);
      return;
    }

    setClient(result.data as ClientBillingRow);
    setLoading(false);
  }

  useEffect(() => {
    void loadBilling();
  }, []);

  const state = useMemo(() => {
    const status = client?.billing_status || "not_configured";

    if (status === "frozen") {
      return {
        tone: "danger",
        icon: <Snowflake size={22} />,
        title: "Website service paused",
        body: "Your website service is paused because billing still needs to be resolved. You can still sign in, review your account, and contact support. New website work and launch actions stay paused until payment is recorded.",
      };
    }

    if (status === "freeze_review") {
      return {
        tone: "warning",
        icon: <Clock3 size={22} />,
        title: "Billing is under freeze review",
        body: "The 14-day grace period has ended and the account is waiting for owner review. Your service has not been frozen automatically. Contact support as soon as possible.",
      };
    }

    if (status === "past_due") {
      return {
        tone: "warning",
        icon: <Clock3 size={22} />,
        title: "Payment is past due",
        body: "Your account is in the 14-day grace period. Website service is still available for now, but the account may move to owner freeze review if payment is not resolved.",
      };
    }

    if (status === "active") {
      return {
        tone: "success",
        icon: <CheckCircle2 size={22} />,
        title: "Billing is active",
        body: "Your billing status is active and no billing action is currently required.",
      };
    }

    return {
      tone: "info",
      icon: <Clock3 size={22} />,
      title: "Billing setup is not complete",
      body: "Billing has not been fully configured yet. Contact support if you expected your subscription to be active.",
    };
  }, [client]);

  return (
    <main className="nxq-page">
      <section className="portal-shell">
        <div className="panel-title panel-title-row">
          <div className="panel-title">
            <Clock3 size={22} />
            <div>
              <h1>Billing status</h1>
              <p className="subtle">Review your current manual billing state and account timing.</p>
            </div>
          </div>

          <a className="icon-btn" href="/client"><ArrowLeft size={16} /> Client portal</a>
        </div>

        {error ? <div className="notice-card error">{error}</div> : null}
        {loading ? <div className="empty-state">Loading billing status...</div> : null}

        {!loading && client ? (
          <>
            <section className={`notice-card portal-decision-notice ${state.tone}`}>
              <div className="panel-title">
                {state.icon}
                <div>
                  <strong>{state.title}</strong>
                  <p>{state.body}</p>
                </div>
              </div>
            </section>

            <section className="panel panel-wide">
              <h2>{client.business_name}</h2>
              <div className="settings-grid">
                <article className="settings-card">
                  <span>Status</span>
                  <strong>{formatStatus(client.billing_status)}</strong>
                  <p>Current billing state for this account.</p>
                </article>
                <article className="settings-card">
                  <span>Monthly plan</span>
                  <strong>{formatMoney(Number(client.monthly_price || 0))}</strong>
                  <p>Manual monthly tracking amount.</p>
                </article>
                <article className="settings-card">
                  <span>Provider</span>
                  <strong>{client.billing_provider || "Not configured"}</strong>
                  <p>No card or bank charge is processed by this status screen.</p>
                </article>
                <article className="settings-card">
                  <span>Overdue since</span>
                  <strong>{formatDate(client.billing_overdue_since)}</strong>
                  <p>The grace-period clock begins from this timestamp.</p>
                </article>
                <article className="settings-card">
                  <span>Frozen at</span>
                  <strong>{formatDate(client.billing_frozen_at)}</strong>
                  <p>Only set after the owner confirms a freeze.</p>
                </article>
                <article className="settings-card">
                  <span>Next due date</span>
                  <strong>{formatDate(client.billing_due_at)}</strong>
                  <p>May remain unset while billing is handled manually.</p>
                </article>
              </div>
            </section>

            <section className="panel panel-wide">
              <div className="panel-title">
                <MessageCircle size={20} />
                <div>
                  <h2>Need help?</h2>
                  <p className="subtle">Message support from the Client Portal or email websitedesignercontact@protonmail.com.</p>
                </div>
              </div>
              <a className="wide-btn" href="/client">Open Client Portal support</a>
            </section>
          </>
        ) : null}
      </section>
    </main>
  );
}
