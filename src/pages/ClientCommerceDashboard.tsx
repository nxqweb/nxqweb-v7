import { useEffect, useState } from "react";
import { ArrowLeft, Boxes, ClipboardList, PackagePlus, ShoppingBag } from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

type CatalogSummary = {
  storefront?: {
    store_name?: string;
    status?: string;
  };
  summary?: {
    products?: number;
    draft_products?: number;
    low_stock_variants?: number;
    out_of_stock_variants?: number;
  };
};

function formatStatus(value: string | undefined) {
  return (value || "setup_pending").replaceAll("_", " ");
}

export function ClientCommerceDashboard() {
  const [catalog, setCatalog] = useState<CatalogSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void loadDashboard();
  }, []);

  async function loadDashboard() {
    setLoading(true);
    setError("");

    if (!isSupabaseConfigured || !supabase) {
      setError("Commerce is unavailable because Supabase is not configured.");
      setLoading(false);
      return;
    }

    const sessionResult = await supabase.auth.getSession();
    if (!sessionResult.data.session) {
      window.location.replace("/portal/login");
      return;
    }

    const result = await supabase.rpc("get_my_commerce_catalog");
    if (result.error) {
      setError(`Commerce dashboard failed to load: ${result.error.message}`);
    } else {
      setCatalog((result.data as CatalogSummary) || null);
    }

    setLoading(false);
  }

  const summary = catalog?.summary || {};

  return (
    <main className="nxq-page">
      <section className="portal-shell">
        <div className="panel-title panel-title-row">
          <div className="panel-title">
            <ShoppingBag size={22} />
            <div>
              <h1>NXQ Commerce</h1>
              <p className="subtle">
                Manage products, inventory, storefront setup, and future orders from one protected workspace.
              </p>
            </div>
          </div>
          <a className="icon-btn" href="/client">
            <ArrowLeft size={16} /> Back to portal
          </a>
        </div>

        {error ? <div className="auth-error">{error}</div> : null}
        {loading ? <div className="empty-state">Loading Commerce...</div> : null}

        {!loading && !error ? (
          <>
            <section className="panel panel-wide">
              <div className="panel-title">
                <ShoppingBag size={20} />
                <div>
                  <h2>{catalog?.storefront?.store_name || "Commerce storefront"}</h2>
                  <p className="subtle">Storefront status: {formatStatus(catalog?.storefront?.status)}</p>
                </div>
              </div>
              <div className="settings-grid">
                <article className="settings-card">
                  <span>Total products</span>
                  <strong>{summary.products || 0}</strong>
                  <p>All product drafts and future published products.</p>
                </article>
                <article className="settings-card">
                  <span>Draft products</span>
                  <strong>{summary.draft_products || 0}</strong>
                  <p>Products still being prepared for review.</p>
                </article>
                <article className="settings-card">
                  <span>Low stock</span>
                  <strong>{summary.low_stock_variants || 0}</strong>
                  <p>Variants at or below their low-stock threshold.</p>
                </article>
                <article className="settings-card">
                  <span>Out of stock</span>
                  <strong>{summary.out_of_stock_variants || 0}</strong>
                  <p>Variants with no currently available inventory.</p>
                </article>
              </div>
            </section>

            <div className="owner-detail-grid">
              <section className="panel">
                <div className="panel-title">
                  <PackagePlus size={20} />
                  <div>
                    <h2>Products</h2>
                    <p className="subtle">Add products, custom facts, variants, prices, and stock.</p>
                  </div>
                </div>
                <a className="wide-btn" href="/client/commerce/products">Open product manager</a>
              </section>

              <section className="panel">
                <div className="panel-title">
                  <ClipboardList size={20} />
                  <div>
                    <h2>Store setup</h2>
                    <p className="subtle">Update design, fulfillment, checkout, and policy requirements.</p>
                  </div>
                </div>
                <a className="wide-btn" href="/client/commerce/setup">Open Commerce setup</a>
              </section>

              <section className="panel">
                <div className="panel-title">
                  <Boxes size={20} />
                  <div>
                    <h2>Advanced inventory</h2>
                    <p className="subtle">Reserved, incoming, low-stock, reorder, and location controls are being connected.</p>
                  </div>
                </div>
                <div className="notice-card">Inventory controls begin inside each product variant in this phase.</div>
              </section>
            </div>
          </>
        ) : null}
      </section>
    </main>
  );
}
