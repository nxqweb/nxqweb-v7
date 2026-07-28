import { useEffect, useState } from "react";
import { Gauge, RefreshCcw } from "lucide-react";
import { CommerceNav } from "../components/CommerceNav";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

type UsageSummary = {
  tier_key: string;
  monthly_product_limit: number;
  monthly_image_limit: number;
  max_image_bytes: number;
  products_used: number;
  images_used: number;
  products_remaining: number;
  images_remaining: number;
  resets_at: string;
};

function percent(used: number, limit: number) {
  if (limit <= 0) return 100;
  return Math.min(Math.round((used / limit) * 100), 100);
}

export function ClientCommerceUsage() {
  const [usage, setUsage] = useState<UsageSummary | null>(null);
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

    const result = await supabase.rpc("get_commerce_usage_summary", { target_client_id: null });
    if (result.error) {
      setError(`Usage failed to load: ${result.error.message}`);
    } else {
      setUsage((result.data as UsageSummary) || null);
    }
    setLoading(false);
  }

  return (
    <main className="nxq-page">
      <section className="portal-shell">
        <div className="panel-title">
          <Gauge size={22} />
          <div>
            <h1>Commerce usage</h1>
            <p className="subtle">See how many new products and product images you can add this month.</p>
          </div>
        </div>

        <CommerceNav />

        <button className="icon-btn" onClick={() => void loadUsage()} disabled={loading}>
          <RefreshCcw size={16} /> {loading ? "Loading..." : "Refresh usage"}
        </button>

        {error ? <div className="auth-error">{error}</div> : null}

        {usage ? (
          <div className="portal-grid" style={{ marginTop: "1rem" }}>
            <article className="panel">
              <h2>New products</h2>
              <div className="status-summary">
                <strong>{usage.products_used} of {usage.monthly_product_limit} used</strong><br />
                {usage.products_remaining} remaining · {percent(usage.products_used, usage.monthly_product_limit)}%
              </div>
              <p className="subtle">Editing an existing product or changing inventory does not use this allowance.</p>
            </article>

            <article className="panel">
              <h2>Product images</h2>
              <div className="status-summary">
                <strong>{usage.images_used} of {usage.monthly_image_limit} used</strong><br />
                {usage.images_remaining} remaining · {percent(usage.images_used, usage.monthly_image_limit)}%
              </div>
              <p className="subtle">Maximum image size: {Math.round(usage.max_image_bytes / 1048576)} MB.</p>
            </article>

            <article className="panel panel-wide">
              <h2>Monthly reset</h2>
              <p className="subtle">Your allowances reset on {new Date(usage.resets_at).toLocaleDateString()}. Existing products remain editable after a limit is reached.</p>
            </article>
          </div>
        ) : null}
      </section>
    </main>
  );
}
