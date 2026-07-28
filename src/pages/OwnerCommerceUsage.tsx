import { useEffect, useState } from "react";
import { ArrowLeft, Gauge, RefreshCcw } from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

type UsageSummary = {
  client_id: string;
  business_name: string;
  contact_email?: string | null;
  monthly_price?: number;
  tier_key: string;
  monthly_product_limit: number;
  monthly_image_limit: number;
  max_image_bytes: number;
  products_used: number;
  images_used: number;
  products_remaining: number;
  images_remaining: number;
  resets_at: string;
  has_override: boolean;
};

function percent(used: number, limit: number) {
  if (limit <= 0) return 100;
  return Math.min(Math.round((used / limit) * 100), 100);
}

export function OwnerCommerceUsage() {
  const [rows, setRows] = useState<UsageSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void loadUsage();
  }, []);

  async function loadUsage() {
    setLoading(true);
    setError("");

    if (!isSupabaseConfigured || !supabase) {
      setError("Commerce usage is unavailable because Supabase is not configured.");
      setLoading(false);
      return;
    }

    const result = await supabase.rpc("get_owner_commerce_usage_summaries");
    if (result.error) {
      setError(`Commerce usage failed to load: ${result.error.message}`);
    } else {
      setRows((result.data as UsageSummary[]) || []);
    }
    setLoading(false);
  }

  return (
    <main className="nxq-page">
      <section className="portal-shell">
        <div className="panel-title panel-title-row">
          <div className="panel-title">
            <Gauge size={22} />
            <div>
              <h1>Commerce usage & limits</h1>
              <p className="subtle">Monthly new-product and image allowances. Normal edits and inventory updates do not count.</p>
            </div>
          </div>
          <a className="icon-btn" href="/owner/commerce"><ArrowLeft size={16} /> Commerce overview</a>
        </div>

        <button className="icon-btn" onClick={() => void loadUsage()} disabled={loading}>
          <RefreshCcw size={16} /> {loading ? "Loading..." : "Refresh"}
        </button>

        {error ? <div className="auth-error">{error}</div> : null}
        {!loading && !error && rows.length === 0 ? <div className="status-summary">No Commerce clients are available yet.</div> : null}

        <div className="portal-grid" style={{ marginTop: "1rem" }}>
          {rows.map((row) => (
            <article className="panel" key={row.client_id}>
              <div className="panel-title panel-title-row">
                <div>
                  <h2>{row.business_name}</h2>
                  <p className="subtle">{row.contact_email || "No email"} · {row.tier_key} · ${Number(row.monthly_price || 0)}/mo</p>
                </div>
                <div className="status-summary">Resets {new Date(row.resets_at).toLocaleDateString()}</div>
              </div>

              <div className="status-summary">
                <strong>New products</strong><br />
                {row.products_used} of {row.monthly_product_limit} used · {row.products_remaining} remaining · {percent(row.products_used, row.monthly_product_limit)}%
              </div>
              <div className="status-summary">
                <strong>Product images</strong><br />
                {row.images_used} of {row.monthly_image_limit} used · {row.images_remaining} remaining · {percent(row.images_used, row.monthly_image_limit)}%
              </div>
              <p className="subtle">Maximum image size: {Math.round(row.max_image_bytes / 1048576)} MB{row.has_override ? " · Owner override active" : ""}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
