import { useCallback, useEffect, useMemo, useState } from "react";
import { Link2 } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import "../styles/stripe-links.css";

type LinkableClient = { id: string; business_name: string; status: string; qa_only: boolean | null };
type LinkRow = { client_id: string; business_name: string; provider_customer_id: string; status: string; created_at: string; updated_at: string };

const CUSTOMER_ID = /^cus_[A-Za-z0-9]{8,64}$/;
const BLOCKED_STATUSES = ["denied", "archived", "dormant"];

// Only the last 4 characters are shown, so a screenshot of this page never exposes a full customer ID.
function maskCustomer(id: string) {
  return `cus_••••${id.slice(-4)}`;
}

export function OwnerStripeCustomerLinks({ clients }: { clients: LinkableClient[] }) {
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [clientId, setClientId] = useState("");
  const [customerId, setCustomerId] = useState("");

  const eligible = useMemo(
    () => clients.filter((client) => !client.qa_only && !BLOCKED_STATUSES.includes(client.status)),
    [clients],
  );

  const loadLinks = useCallback(async () => {
    if (!supabase) {
      setError("Supabase is not configured yet.");
      setLoading(false);
      return;
    }
    setLoading(true);
    const result = await supabase.rpc("owner_list_stripe_customer_links");
    if (result.error) setError(`Stripe customer links could not be loaded: ${result.error.message}`);
    else setLinks((result.data || []) as LinkRow[]);
    setLoading(false);
  }, []);

  useEffect(() => { void loadLinks(); }, [loadLinks]);

  async function linkCustomer() {
    if (!supabase || busy) return;
    setError("");
    setMessage("");
    const value = customerId.trim();
    const client = eligible.find((row) => row.id === clientId);
    if (!client) { setError("Choose a client first."); return; }
    if (!CUSTOMER_ID.test(value)) {
      setError("That does not look like a Stripe customer ID. It starts with cus_ followed by letters and numbers. Never paste a secret key here.");
      return;
    }
    if (!window.confirm(`Link Stripe customer ${maskCustomer(value)} to ${client.business_name}?\n\nThis only records which Stripe customer belongs to this client. It does not charge anything or change billing.`)) return;

    setBusy(true);
    const result = await supabase.rpc("owner_link_stripe_customer", { target_client_id: client.id, target_customer_id: value });
    setBusy(false);
    if (result.error) { setError(`Link failed: ${result.error.message}`); return; }
    setMessage(String((result.data as { message?: string } | null)?.message || "Stripe customer linked."));
    setCustomerId("");
    await loadLinks();
  }

  async function disableLink(row: LinkRow) {
    if (!supabase || busy) return;
    setError("");
    setMessage("");
    if (!window.confirm(`Turn off the Stripe link for ${row.business_name}?\n\nPayment events from ${maskCustomer(row.provider_customer_id)} will stop being accepted for this client until it is linked again.`)) return;
    setBusy(true);
    const result = await supabase.rpc("owner_disable_stripe_customer_link", { target_client_id: row.client_id, disable_note: null });
    setBusy(false);
    if (result.error) { setError(`Could not turn the link off: ${result.error.message}`); return; }
    setMessage(`Stripe link turned off for ${row.business_name}.`);
    await loadLinks();
  }

  return (
    <section className="panel panel-wide" aria-label="Stripe customer links">
      <div className="panel-title">
        <Link2 size={20} />
        <div>
          <h2>Stripe customer links</h2>
          <p className="subtle">
            Record which Stripe customer belongs to which client, so payment events from Stripe can be matched to the right account.
            Paste only the customer ID (it starts with <code>cus_</code>). Never paste a secret key or API key here. QA-only clients cannot be linked.
          </p>
        </div>
      </div>

      {error ? <div className="auth-error" role="alert">{error}</div> : null}
      {message ? <p className="nxq-stripe-message" role="status">{message}</p> : null}

      <div className="nxq-stripe-form">
        <label>
          <span className="subtle">Client</span>
          <select value={clientId} onChange={(event) => setClientId(event.target.value)} disabled={busy}>
            <option value="">Choose a client…</option>
            {eligible.map((client) => <option key={client.id} value={client.id}>{client.business_name}</option>)}
          </select>
        </label>
        <label>
          <span className="subtle">Stripe customer ID</span>
          <input
            type="text"
            value={customerId}
            onChange={(event) => setCustomerId(event.target.value)}
            placeholder="cus_..."
            autoComplete="off"
            spellCheck={false}
            maxLength={80}
            disabled={busy}
          />
        </label>
        <button className="icon-btn" type="button" onClick={() => void linkCustomer()} disabled={busy || !clientId || !customerId.trim()}>
          {busy ? "Working…" : "Link customer"}
        </button>
      </div>

      {loading ? <div className="empty-state" role="status">Loading links…</div> : null}
      {!loading && links.length === 0 && !error ? <div className="empty-state">No Stripe customers are linked yet.</div> : null}
      {links.map((row) => (
        <article className="owner-message-card" key={row.client_id}>
          <div className="owner-message-top">
            <strong>{row.business_name}</strong>
            <span>{row.status === "active" ? "Active" : row.status === "disabled" ? "Turned off" : row.status}</span>
          </div>
          <p className="subtle">{maskCustomer(row.provider_customer_id)} · updated {new Date(row.updated_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</p>
          {row.status === "active" ? (
            <button className="icon-btn" type="button" onClick={() => void disableLink(row)} disabled={busy}>Turn off link</button>
          ) : null}
        </article>
      ))}
    </section>
  );
}
