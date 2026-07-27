import { useEffect, useState } from "react";
import { ArrowLeft, Boxes, ClipboardList, PackagePlus, ShoppingBag, Tags } from "lucide-react";
import { CommerceNav } from "../components/CommerceNav";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

type CatalogSummary = {
  storefront?: { store_name?: string; status?: string };
  summary?: { products?: number; draft_products?: number; low_stock_variants?: number; out_of_stock_variants?: number };
};

type CommerceIntakeSummary = {
  status?: string;
  existing_site_detected?: boolean;
  detected_site_url?: string | null;
  detected_site_source?: string | null;
};

function formatStatus(value: string | undefined) { return (value || "setup_pending").replaceAll("_", " "); }
function formatSource(value: string | null | undefined) { return (value || "account data").replaceAll("_", " "); }

export function ClientCommerceDashboard() {
  const [catalog, setCatalog] = useState<CatalogSummary | null>(null);
  const [intake, setIntake] = useState<CommerceIntakeSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => { void loadDashboard(); }, []);

  async function loadDashboard() {
    setLoading(true); setError("");
    if (!isSupabaseConfigured || !supabase) { setError("Commerce is unavailable because Supabase is not configured."); setLoading(false); return; }
    const sessionResult = await supabase.auth.getSession();
    if (!sessionResult.data.session) { window.location.replace("/portal/login"); return; }
    const ensureResult = await supabase.rpc("ensure_my_commerce_onboarding");
    if (ensureResult.error) { setError(`Commerce onboarding could not be prepared: ${ensureResult.error.message}`); setLoading(false); return; }
    const ensureData = ensureResult.data as { provisioned?: boolean; reason?: string } | null;
    if (ensureData?.provisioned === false && ensureData.reason === "not_commerce") { setError("This client account is not currently approved for NXQ Commerce."); setLoading(false); return; }
    const [catalogResult, intakeResult] = await Promise.all([supabase.rpc("get_my_commerce_catalog"), supabase.rpc("get_my_commerce_intake")]);
    if (catalogResult.error) setError(`Commerce dashboard failed to load: ${catalogResult.error.message}`);
    else if (intakeResult.error) setError(`Commerce setup status failed to load: ${intakeResult.error.message}`);
    else { setCatalog((catalogResult.data as CatalogSummary) || null); setIntake((intakeResult.data as CommerceIntakeSummary) || null); }
    setLoading(false);
  }

  const summary = catalog?.summary || {};
  const setupNeedsAttention = !intake || ["draft", "needs_more_info"].includes(intake.status || "draft");

  return (
    <main className="nxq-page"><section className="portal-shell">
      <CommerceNav />
      <div className="panel-title panel-title-row"><div className="panel-title"><ShoppingBag size={22} /><div><h1>NXQ Commerce</h1><p className="subtle">Manage products, categories, inventory, storefront setup, and future orders from one protected workspace.</p></div></div><a className="icon-btn" href="/client"><ArrowLeft size={16} /> Back to portal</a></div>
      {error ? <div className="auth-error">{error}</div> : null}
      {loading ? <div className="empty-state">Loading Commerce...</div> : null}
      {!loading && !error ? <>
        {setupNeedsAttention ? <section className="panel panel-wide"><div className="panel-title"><ClipboardList size={20} /><div><h2>Commerce setup required</h2><p className="subtle">Finish the storefront setup before NXQ prepares the build and migration plan.</p></div></div>{intake?.existing_site_detected && intake.detected_site_url ? <div className="notice-card success"><strong>Existing website detected automatically</strong><p>{intake.detected_site_url}</p><p className="subtle">Found from {formatSource(intake.detected_site_source)}.</p></div> : null}<a className="wide-btn" href="/client/commerce/setup">Complete Commerce setup</a></section> : null}
        <section className="panel panel-wide"><div className="panel-title"><ShoppingBag size={20} /><div><h2>{catalog?.storefront?.store_name || "Commerce storefront"}</h2><p className="subtle">Storefront status: {formatStatus(catalog?.storefront?.status)}</p></div></div><div className="settings-grid"><article className="settings-card"><span>Total products</span><strong>{summary.products || 0}</strong><p>All product drafts and future published products.</p></article><article className="settings-card"><span>Draft products</span><strong>{summary.draft_products || 0}</strong><p>Products still being prepared for review.</p></article><article className="settings-card"><span>Low stock</span><strong>{summary.low_stock_variants || 0}</strong><p>Variants at or below their low-stock threshold.</p></article><article className="settings-card"><span>Out of stock</span><strong>{summary.out_of_stock_variants || 0}</strong><p>Variants with no currently available inventory.</p></article></div></section>
        <div className="owner-detail-grid">
          <section className="panel"><div className="panel-title"><PackagePlus size={20} /><div><h2>Products</h2><p className="subtle">Add product facts, variants, prices, and stock.</p></div></div><a className="wide-btn" href="/client/commerce/products">Open product manager</a></section>
          <section className="panel"><div className="panel-title"><Tags size={20} /><div><h2>Categories</h2><p className="subtle">Organize products and subcategories.</p></div></div><a className="wide-btn" href="/client/commerce/categories">Manage categories</a></section>
          <section className="panel"><div className="panel-title"><Boxes size={20} /><div><h2>Advanced inventory</h2><p className="subtle">View all variants, warnings, locations, and adjustments.</p></div></div><a className="wide-btn" href="/client/commerce/inventory">Open inventory</a></section>
          <section className="panel"><div className="panel-title"><ClipboardList size={20} /><div><h2>Store setup</h2><p className="subtle">Update design, fulfillment, checkout, and policy requirements.</p></div></div><a className="wide-btn" href="/client/commerce/setup">Open Commerce setup</a></section>
        </div>
      </> : null}
    </section></main>
  );
}
