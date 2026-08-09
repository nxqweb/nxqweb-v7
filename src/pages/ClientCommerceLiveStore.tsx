import { useEffect, useState } from "react";
import { ExternalLink, Save, Store, ToggleLeft, ToggleRight } from "lucide-react";
import { CommerceNav } from "../components/CommerceNav";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

type LiveProduct = {
  id: string;
  name: string;
  status: string;
  base_price: number;
  image_url?: string | null;
};

type LiveSettings = {
  store_name: string;
  store_slug: string;
  status: string;
  paypal_url?: string | null;
  venmo_url?: string | null;
  payment_note?: string | null;
  public_url: string;
  products: LiveProduct[];
};

export function ClientCommerceLiveStore() {
  const [data, setData] = useState<LiveSettings | null>(null);
  const [storeName, setStoreName] = useState("");
  const [paypalUrl, setPaypalUrl] = useState("");
  const [venmoUrl, setVenmoUrl] = useState("");
  const [paymentNote, setPaymentNote] = useState("");
  const [images, setImages] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => { void load(); }, []);

  async function load() {
    setLoading(true);
    setError("");
    if (!isSupabaseConfigured || !supabase) {
      setError("Commerce live-store settings are unavailable because Supabase is not configured.");
      setLoading(false);
      return;
    }
    const session = await supabase.auth.getSession();
    if (!session.data.session) { window.location.replace("/portal/login"); return; }
    const result = await supabase.rpc("get_my_live_storefront_settings");
    if (result.error) setError(`Live store failed to load: ${result.error.message}`);
    else {
      const next = result.data as LiveSettings;
      setData(next);
      setStoreName(next.store_name || "");
      setPaypalUrl(next.paypal_url || "");
      setVenmoUrl(next.venmo_url || "");
      setPaymentNote(next.payment_note || "");
      setImages(Object.fromEntries((next.products || []).map((product) => [product.id, product.image_url || ""])));
    }
    setLoading(false);
  }

  async function save(makeLive: boolean) {
    if (!supabase) return;
    setBusy("settings"); setError(""); setMessage("");
    const result = await supabase.rpc("save_my_live_storefront_settings", {
      store_name_value: storeName,
      paypal_url_value: paypalUrl || null,
      venmo_url_value: venmoUrl || null,
      payment_note_value: paymentNote || null,
      make_live: makeLive,
    });
    if (result.error) setError(`Store settings could not be saved: ${result.error.message}`);
    else {
      setMessage(makeLive ? "Your storefront is live. Product changes remain under your control." : "Storefront saved as a private draft.");
      await load();
    }
    setBusy("");
  }

  async function toggleProduct(product: LiveProduct) {
    if (!supabase) return;
    setBusy(product.id); setError(""); setMessage("");
    const result = await supabase.rpc("set_my_commerce_product_live", {
      product_uuid: product.id,
      make_active: product.status !== "active",
      primary_image_url: images[product.id]?.trim() || null,
    });
    if (result.error) setError(`Product could not be updated: ${result.error.message}`);
    else {
      setMessage(`${product.name} is now ${product.status === "active" ? "hidden" : "live"}.`);
      await load();
    }
    setBusy("");
  }

  const liveUrl = data ? `${window.location.origin}${data.public_url}` : "";

  return (
    <main className="nxq-page"><section className="portal-shell">
      <CommerceNav />
      <div className="panel-title"><Store size={22} /><div><h1>Live storefront</h1><p className="subtle">You own and control what appears in your store. NXQ only enforces plan and technical limits.</p></div></div>

      {error ? <div className="auth-error">{error}</div> : null}
      {message ? <div className="auth-success">{message}</div> : null}
      {loading ? <div className="empty-state">Loading live storefront...</div> : null}

      {!loading && data ? <>
        <section className="panel panel-wide">
          <div className="panel-title"><Save size={20} /><div><h2>Store and direct payments</h2><p className="subtle">Customers place an order here, then pay directly to your public PayPal or Venmo business link.</p></div></div>
          <div className="setup-form-grid">
            <label><span>Store name</span><input className="auth-input" value={storeName} onChange={(e) => setStoreName(e.target.value)} /></label>
            <label><span>PayPal or PayPal.Me link</span><input className="auth-input" placeholder="https://paypal.me/yourbusiness" value={paypalUrl} onChange={(e) => setPaypalUrl(e.target.value)} /></label>
            <label><span>Venmo business profile link</span><input className="auth-input" placeholder="https://venmo.com/u/yourbusiness" value={venmoUrl} onChange={(e) => setVenmoUrl(e.target.value)} /></label>
            <label><span>Payment instructions</span><input className="auth-input" placeholder="Include the order number in your payment note." value={paymentNote} onChange={(e) => setPaymentNote(e.target.value)} /></label>
          </div>
          <div className="settings-grid">
            <button className="wide-btn" disabled={busy === "settings"} onClick={() => void save(false)} type="button">Save private draft</button>
            <button className="wide-btn" disabled={busy === "settings"} onClick={() => void save(true)} type="button">Open storefront</button>
          </div>
          <p className="subtle" style={{ marginTop: ".75rem" }}>Never enter a PayPal/Venmo password, bank account, API secret, or login code here. Only public payment links belong in these fields.</p>
          {data.status === "active" ? <a className="wide-btn" href={liveUrl} target="_blank" rel="noreferrer"><ExternalLink size={16} /> Open live storefront</a> : null}
        </section>

        <section className="panel panel-wide">
          <div className="panel-title"><Store size={20} /><div><h2>Product visibility</h2><p className="subtle">Turn products on or off yourself. Changes appear on the storefront immediately.</p></div></div>
          {(data.products || []).length === 0 ? <div className="empty-state">Add products first, then return here to make them live.</div> : data.products.map((product) => (
            <article className="settings-card" key={product.id} style={{ marginBottom: ".75rem" }}>
              <div className="panel-title panel-title-row">
                <div><strong>{product.name}</strong><p>${Number(product.base_price || 0).toFixed(2)} · {product.status}</p></div>
                <button className="icon-btn" disabled={busy === product.id} onClick={() => void toggleProduct(product)} type="button">
                  {product.status === "active" ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                  {busy === product.id ? "Saving..." : product.status === "active" ? "Hide product" : "Make live"}
                </button>
              </div>
              <label><span>Primary product image URL</span><input className="auth-input" placeholder="https://..." value={images[product.id] || ""} onChange={(e) => setImages((current) => ({ ...current, [product.id]: e.target.value }))} /></label>
            </article>
          ))}
        </section>
      </> : null}
    </section></main>
  );
}
