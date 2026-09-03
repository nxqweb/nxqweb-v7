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

function UsageBar({ used, limit }: { used: number; limit: number }) {
  const value = percent(used, limit);

  return (
    <div
      aria-label={`${value}% of allowance used`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      style={{
        width: "100%",
        height: "10px",
        borderRadius: "999px",
        overflow: "hidden",
        border: "1px solid rgba(255, 221, 87, 0.35)",
        background: "rgba(255, 255, 255, 0.06)",
        margin: "0.9rem 0",
      }}
    >
      <div
        style={{
          width: `${value}%`,
          minWidth: value > 0 ? "8px" : 0,
          height: "100%",
          borderRadius: "inherit",
          background: "linear-gradient(90deg, #57e6ff, #ffdd57)",
          transition: "width 180ms ease",
        }}
      />
    </div>
  );
}

export function ClientCommerceUsage() {
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void loadUsage();
  }, []);

  async function loadUsage() {
    setLoading(true);
    setVerified(false);
    setError("");

    if (!isSupabaseConfigured || !supabase) {
      setUsage(null);
      setError("Commerce usage is temporarily unavailable. No allowance values are being shown until they can be verified.");
      setLoading(false);
      return;
    }

    const sessionResult = await supabase.auth.getSession();
    if (!sessionResult.data.session) {
      window.location.replace("/portal/login");
      return;
    }

    const result = await supabase.rpc("get_commerce_usage_summary", { target_client_id: null });
    if (result.error || !result.data) {
      setUsage(null);
      setError("Commerce usage could not be verified right now. Please refresh and try again.");
      setLoading(false);
      return;
    }

    setUsage(result.data as UsageSummary);
    setVerified(true);
    setLoading(false);
  }

  return (
    <main className="nxq-page">
      <section className="portal-shell">
        <div className="panel-title" style={{ alignItems: "flex-start" }}>
          <Gauge size={22} />
          <div>
            <h1 style={{ fontSize: "clamp(3rem, 7vw, 5.75rem)", lineHeight: 0.94, marginBottom: "0.75rem" }}>
              Commerce usage
            </h1>
            <p className="subtle">See verified monthly product and product-image usage for your Commerce workspace.</p>
          </div>
        </div>

        <CommerceNav />

        <button className="icon-btn" onClick={() => void loadUsage()} disabled={loading} type="button">
          <RefreshCcw size={16} /> {loading ? "Loading..." : "Refresh usage"}
        </button>

        {error ? <div className="auth-error" role="alert">{error}</div> : null}
        {loading ? <div className="empty-state">Loading Commerce usage...</div> : null}

        {!loading && verified && usage ? (
          <div className="portal-grid" style={{ marginTop: "1rem" }}>
            <article className="panel">
              <h2>New products</h2>
              <div className="status-summary">
                <strong>{usage.products_used} of {usage.monthly_product_limit} used</strong><br />
                {usage.products_remaining} remaining · {percent(usage.products_used, usage.monthly_product_limit)}%
              </div>
              <UsageBar used={usage.products_used} limit={usage.monthly_product_limit} />
              <p className="subtle">Editing an existing product or changing inventory does not use this allowance.</p>
            </article>

            <article className="panel">
              <h2>Product images</h2>
              <div className="status-summary">
                <strong>{usage.images_used} of {usage.monthly_image_limit} used</strong><br />
                {usage.images_remaining} remaining · {percent(usage.images_used, usage.monthly_image_limit)}%
              </div>
              <UsageBar used={usage.images_used} limit={usage.monthly_image_limit} />
              <p className="subtle">Maximum image size: {Math.round(usage.max_image_bytes / 1048576)} MB.</p>
            </article>

            <article className="panel panel-wide">
              <h2>Monthly reset</h2>
              <p className="subtle">Your verified allowances reset on {new Date(usage.resets_at).toLocaleDateString()}. Existing products remain editable after a limit is reached.</p>
            </article>
          </div>
        ) : null}
      </section>
    </main>
  );
}
