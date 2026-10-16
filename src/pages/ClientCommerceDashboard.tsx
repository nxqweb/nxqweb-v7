import { useEffect, useState } from "react";
import { ArrowLeft, CircleHelp, ClipboardList, Inbox, PackagePlus, ShieldCheck, ShoppingBag } from "lucide-react";
import { CommerceNav } from "../components/CommerceNav";
import { launchGuideSteps, readAutoOff, readDoneSteps, shouldShowGuidePrompt, writeAutoOff } from "../lib/commerceLaunchGuide";
import { orderAttentionMessage, summarizeOrderAttention, type OrderAttention } from "../lib/orderAttention";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

type CatalogSummary = {
  storefront?: { store_name?: string; store_slug?: string; status?: string };
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
function metric(value: number | undefined) { return typeof value === "number" ? value : "—"; }

export function ClientCommerceDashboard() {
  const [catalog, setCatalog] = useState<CatalogSummary | null>(null);
  const [intake, setIntake] = useState<CommerceIntakeSummary | null>(null);
  const [orderAttention, setOrderAttention] = useState<OrderAttention | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [guideAutoOff, setGuideAutoOff] = useState(() => readAutoOff());

  useEffect(() => { void loadDashboard(); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- loads once when the page opens

  async function loadDashboard() {
    setLoading(true);
    setError("");
    setCatalog(null);
    setIntake(null);

    if (!isSupabaseConfigured || !supabase) {
      setError("NXQX-Commerce is temporarily unavailable. Please try again later.");
      setLoading(false);
      return;
    }

    const sessionResult = await supabase.auth.getSession();
    if (sessionResult.error) {
      setError("Your Commerce session could not be verified. Please refresh or sign in again.");
      setLoading(false);
      return;
    }
    if (!sessionResult.data.session) {
      window.location.replace("/portal/login");
      return;
    }

    const ensureResult = await supabase.rpc("ensure_my_commerce_onboarding");
    if (ensureResult.error) {
      setError("NXQX-Commerce setup could not be verified right now. Please try again shortly.");
      setLoading(false);
      return;
    }

    const ensureData = ensureResult.data as { provisioned?: boolean; reason?: string } | null;
    if (ensureData?.provisioned === false && ensureData.reason === "not_commerce") {
      setError("This client account is not currently approved for NXQX-Commerce.");
      setLoading(false);
      return;
    }
    if (ensureData?.provisioned === false) {
      setError("NXQX-Commerce is not ready for this account yet. No storefront changes were made.");
      setLoading(false);
      return;
    }

    const [catalogResult, intakeResult] = await Promise.all([
      supabase.rpc("get_my_commerce_catalog"),
      supabase.rpc("get_my_commerce_intake"),
    ]);

    if (catalogResult.error || intakeResult.error) {
      setError("Some Commerce workspace data could not be verified right now. No storefront or inventory changes were made.");
      setLoading(false);
      return;
    }

    setCatalog((catalogResult.data as CatalogSummary) || null);
    setIntake((intakeResult.data as CommerceIntakeSummary) || null);

    // Orders waiting for the owner: fetched in the background (and only once a store exists) so it never delays or blocks the dashboard.
    if ((catalogResult.data as CatalogSummary | null)?.storefront) void loadOrderAttention();
    setLoading(false);
  }

  async function loadOrderAttention() {
    if (!supabase) return;
    try {
      const ordersResult = await supabase.rpc("get_my_commerce_orders");
      if (!ordersResult.error) setOrderAttention(summarizeOrderAttention(ordersResult.data));
    } catch { /* the card simply stays hidden */ }
  }

  const showGuidePrompt = shouldShowGuidePrompt(readDoneSteps(), guideAutoOff);
  const summary = catalog?.summary;
  const setupNeedsAttention = !intake || ["draft", "needs_more_info"].includes(intake.status || "draft");
  const checkoutHref = catalog?.storefront?.store_slug ? `/store/checkout?store=${encodeURIComponent(catalog.storefront.store_slug)}` : "";

  return (
    <main className="nxq-page"><section className="portal-shell">
      <CommerceNav />
      <div className="panel-title panel-title-row"><div className="panel-title"><ShoppingBag size={22} /><div><h1>NXQX-Commerce</h1><p className="subtle">Add products, photos and open your store. Your orders show up here too.</p></div></div><a className="icon-btn" href="/client"><ArrowLeft size={16} /> Back to portal</a></div>
      {error ? <div className="auth-error" role="alert">{error}</div> : null}
      {loading ? <div className="empty-state" role="status">Loading Commerce...</div> : null}
      {!loading && !error ? <>
        {orderAttention ? <section className="panel panel-wide" data-testid="orders-waiting-card"><div className="panel-title panel-title-row"><div className="panel-title"><Inbox size={20} /><div><h2>Orders</h2><p className="subtle">{orderAttentionMessage(orderAttention)}</p></div></div><a className={orderAttention.awaitingPayment + orderAttention.toShip > 0 ? "wide-btn" : "icon-btn"} href="/client/commerce/orders">Open orders</a></div></section> : null}
        {showGuidePrompt ? <section className="panel panel-wide"><div className="panel-title"><CircleHelp size={20} /><div><h2>New here? Launch your store step by step</h2><p className="subtle">{launchGuideSteps.length} short steps, from an empty store to your first order. You can replay it any time from the Tutorial tab.</p></div></div><a className="wide-btn" href="/client/commerce/tutorial">Start the guide</a><button className="icon-btn" type="button" onClick={() => { writeAutoOff(true); setGuideAutoOff(true); }}>Don't remind me again</button></section> : null}
        {setupNeedsAttention ? <section className="panel panel-wide"><div className="panel-title"><ClipboardList size={20} /><div><h2>Store setup</h2><p className="subtle">Only the store name is required. Everything else on the setup form is optional, and you can add it later.</p></div></div>{intake?.existing_site_detected && intake.detected_site_url ? <div className="notice-card success"><strong>Existing website detected automatically</strong><p>{intake.detected_site_url}</p><p className="subtle">Found from {formatSource(intake.detected_site_source)}.</p></div> : null}<a className="wide-btn" href="/client/commerce/setup">Open store setup form</a></section> : null}
        <section className="panel panel-wide"><div className="panel-title"><ShoppingBag size={20} /><div><h2>{catalog?.storefront?.store_name || "Commerce storefront"}</h2><p className="subtle">Storefront status: {formatStatus(catalog?.storefront?.status)}</p></div></div><div className="settings-grid"><article className="settings-card"><span>Total products</span><strong>{metric(summary?.products)}</strong><p>Drafts and live products.</p></article><article className="settings-card"><span>Draft products</span><strong>{metric(summary?.draft_products)}</strong><p>Not visible to customers yet.</p></article><article className="settings-card"><span>Low stock</span><strong>{metric(summary?.low_stock_variants)}</strong><p>Running low.</p></article><article className="settings-card"><span>Out of stock</span><strong>{metric(summary?.out_of_stock_variants)}</strong><p>Nothing left to sell.</p></article></div></section>
        {checkoutHref ? <section className="panel panel-wide"><div className="panel-title"><ShieldCheck size={20} /><div><h2>Test your checkout</h2><p className="subtle">Try the cart and order steps like a customer. No real payment is taken.</p></div></div><a className="wide-btn" href={checkoutHref}><ShieldCheck size={17} /> Open checkout test</a></section> : null}
        <section className="panel panel-wide" data-testid="quick-actions"><div className="panel-title"><PackagePlus size={20} /><div><h2>Quick actions</h2><p className="subtle">The everyday jobs. Everything else is in the menu above.</p></div></div><div className="quick-actions"><a className="wide-btn" href="/client/commerce/products">Add a product</a><a className="icon-btn" href="/client/commerce/images">Add photos</a><a className="icon-btn" href="/client/commerce/live">Live store</a><a className="icon-btn" href="/client/commerce/orders">Orders</a></div></section>
      </> : null}
    </section></main>
  );
}
