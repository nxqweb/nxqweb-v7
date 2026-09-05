import { useEffect, useMemo, useState } from "react";
import { RefreshCcw, ShieldCheck, Users } from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

type CommerceClient = {
  client_id: string;
  business_name: string;
  contact_email?: string | null;
  monthly_price: number;
  storefront_status?: string | null;
  intake?: Record<string, unknown> | null;
};

function human(value: unknown) {
  if (value === null || value === undefined || value === "") return "Not provided";
  return String(value).replaceAll("_", " ");
}

export function OwnerCommerceReviews() {
  const client = useMemo(() => (isSupabaseConfigured && supabase ? supabase : null), []);
  const [clients, setClients] = useState<CommerceClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- initial owner review load only

  async function load() {
    setLoading(true);
    setError("");
    if (!client) {
      setError("Supabase is not configured.");
      setLoading(false);
      return;
    }

    const result = await client.rpc("get_owner_commerce_reviews");
    if (result.error) setError(`Commerce clients failed to load: ${result.error.message}`);
    else setClients((result.data as CommerceClient[]) || []);
    setLoading(false);
  }

  return (
    <main className="nxq-page">
      <section className="portal-shell">
        <div className="panel-title panel-title-row">
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
            <Users size={24} />
            <div>
              <h1>Commerce clients</h1>
              <p className="subtle">Manage plans, limits, setup state, and major storefront requests without reviewing routine client store data.</p>
            </div>
          </div>
          <a className="icon-btn" href="/owner/commerce">← Commerce overview</a>
        </div>

        <div className="panel panel-wide">
          <div className="panel-title">
            <ShieldCheck size={20} />
            <div>
              <h2>Privacy-first management</h2>
              <p className="subtle">Products, images, prices, categories, inventory, and normal edits remain client-managed. NXQ only surfaces account status and actions that require owner authority.</p>
            </div>
          </div>
        </div>

        <button className="icon-btn" onClick={() => void load()} type="button"><RefreshCcw size={16} /> Refresh</button>
        {error ? <div className="auth-error">{error}</div> : null}
        {loading ? <div className="empty-state">Loading Commerce clients...</div> : null}
        {!loading && clients.length === 0 ? <div className="empty-state">No Commerce clients are available.</div> : null}

        <div style={{ display: "grid", gap: "1rem", marginTop: "1rem" }}>
          {clients.map((commerceClient) => {
            const intake = commerceClient.intake || {};
            const intakeStatus = human(intake.status || "draft");
            const setupSubmitted = intake.status === "submitted" || intake.status === "approved";
            const storefrontStatus = human(commerceClient.storefront_status || "setup pending");

            return (
              <article className="panel panel-wide" key={commerceClient.client_id} style={{ display: "grid", gap: "1rem" }}>
                <div className="panel-title panel-title-row">
                  <div>
                    <h2>{commerceClient.business_name}</h2>
                    <p className="subtle">{commerceClient.contact_email || "No contact email"} · ${Number(commerceClient.monthly_price || 0).toFixed(0)}/mo</p>
                  </div>
                  <strong>{setupSubmitted ? "Client-managed" : "Setup incomplete"}</strong>
                </div>

                <div className="owner-detail-grid">
                  <div className="settings-card"><strong>{intakeStatus}</strong><span className="subtle">Setup status</span></div>
                  <div className="settings-card"><strong>{storefrontStatus}</strong><span className="subtle">Storefront status</span></div>
                  <div className="settings-card"><strong>Automatic</strong><span className="subtle">Product and image limits</span></div>
                  <div className="settings-card"><strong>Client owned</strong><span className="subtle">Routine store data</span></div>
                </div>

                {!setupSubmitted ? (
                  <div className="auth-error" style={{ textAlign: "left" }}>
                    <strong>Client action needed</strong>
                    <p style={{ marginBottom: 0 }}>The Commerce setup sheet has not been submitted. This is shown for status only; routine uploads do not require owner approval.</p>
                  </div>
                ) : (
                  <div className="auth-success"><strong>Normal Commerce management is running without owner review.</strong></div>
                )}

                <div className="panel-title-row" style={{ gap: "0.75rem", flexWrap: "wrap" }}>
                  <a className="icon-btn" href="/owner/commerce-usage">View usage & limits</a>
                  <a className="wide-btn" href="/owner/commerce-builds">View major build & launch requests</a>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}
