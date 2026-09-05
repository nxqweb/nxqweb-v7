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
  stripe_payment_link?: string | null;
  paypal_url?: string | null;
  venmo_url?: string | null;
  payment_note?: string | null;
  public_url: string;
  products: LiveProduct[];
};

export function ClientCommerceLiveStore() {
  const [data, setData] = useState<LiveSettings | null>(null);
  const [storeName, setStoreName] = useState("");
  const [stripePaymentLink, setStripePaymentLink] = useState("");
  const [paypalUrl, setPaypalUrl] = useState("");
  const [venmoUrl, setVenmoUrl] = useState("");
  const [paymentNote, setPaymentNote] = useState("");
  const [images, setImages] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => { void load(); }, []);

  async function load() {
    setLoading(true);
    setVerified(false);
    setError("");
    setData(null);

    if (!isSupabaseConfigured || !supabase) {
      setError("Commerce storefront settings are temporarily unavailable. No storefront changes were made.");
      setLoading(false);
      return;
    }

    const session = await supabase.auth.getSession();
    if (!session.data.session) {
      window.location.replace("/portal/login");
      return;
    }

    const result = await supabase.rpc("get_my_stripe_ready_storefront_settings");
    if (result.error || !result.data) {
      setError("Storefront settings could not be verified right now. Please try again shortly.");
      setLoading(false);
      return;
    }

    const next = result.data as LiveSettings;
    setData(next);
    setStoreName(next.store_name || "");
    setStripePaymentLink(next.stripe_payment_link || "");
    setPaypalUrl(next.paypal_url || "");
    setVenmoUrl(next.venmo_url || "");
    setPaymentNote(next.payment_note || "");
    setImages(Object.fromEntries((next.products || []).map((product) => [product.id, product.image_url || ""])));
    setVerified(true);
    setLoading(false);
  }

  async function save(makeLive: boolean) {
    if (!supabase || !verified || !data) return;

    if (makeLive) {
      const confirmed = window.confirm(
        "Open this storefront now? This can make the storefront publicly reachable, but it does not activate a payment provider or charge anyone."
      );
      if (!confirmed) return;
    }

    setBusy("settings");
    setError("");
    setMessage("");

    const result = await supabase.rpc("save_my_stripe_ready_storefront_settings", {
      store_name_value: storeName,
      stripe_payment_link_value: stripePaymentLink || null,
      legacy_paypal_url_value: paypalUrl || null,
      legacy_venmo_url_value: venmoUrl || null,
      payment_note_value: paymentNote || null,
      make_live: makeLive,
    });

    if (result.error) {
      setError(
        makeLive
          ? "Storefront activation could not be completed. The previously verified storefront state remains in place."
          : "Storefront settings could not be saved. The previously verified storefront state remains in place."
      );
      setBusy("");
      return;
    }

    setMessage(
      makeLive
        ? "Storefront activation was accepted. Payment-provider activation remains separate and protected."
        : "Storefront saved as a private draft."
    );
    await load();
    setBusy("");
  }

  async function toggleProduct(product: LiveProduct) {
    if (!supabase || !verified) return;

    const makingLive = product.status !== "active";
    const confirmed = window.confirm(
      makingLive
        ? `Make ${product.name} visible on the storefront?`
        : `Hide ${product.name} from the storefront?`
    );
    if (!confirmed) return;

    setBusy(product.id);
    setError("");
    setMessage("");

    const result = await supabase.rpc("set_my_commerce_product_live", {
      product_uuid: product.id,
      make_active: makingLive,
      primary_image_url: images[product.id]?.trim() || null,
    });

    if (result.error) {
      setError("Product visibility could not be changed. The previous verified product state remains in place.");
      setBusy("");
      return;
    }

    setMessage(`${product.name} is now ${makingLive ? "visible" : "hidden"} on the storefront.`);
    await load();
    setBusy("");
  }

  const liveUrl = data ? `${window.location.origin}${data.public_url}` : "";

  return (
    <main className="nxq-page"><section className="portal-shell">
      <CommerceNav />
      <div className="panel-title"><Store size={22} /><div><h1>Live storefront</h1><p className="subtle">You control storefront visibility. Payment-provider activation, billing, and production approvals remain separate protected actions.</p></div></div>

      {error ? <div className="auth-error" role="alert">{error}</div> : null}
      {message ? <div className="auth-success">{message}</div> : null}
      {loading ? <div className="empty-state" role="status">Loading storefront settings...</div> : null}
      {!loading && !verified ? <div className="empty-state">Storefront settings could not be verified, so publishing controls are unavailable.</div> : null}

      {!loading && verified && data ? <>
        <section className="panel panel-wide">
          <div className="panel-title"><Save size={20} /><div><h2>Store and payment handoff</h2><p className="subtle">A public payment link can be recorded here later, but this page does not create a payment account, store secrets, charge customers, or connect payouts.</p></div></div>
          <div className="setup-form-grid">
            <label><span>Store name</span><input className="auth-input" value={storeName} onChange={(e) => setStoreName(e.target.value)} /></label>
            <label><span>Stripe Payment Link</span><input className="auth-input" placeholder="Public payment link only" value={stripePaymentLink} onChange={(e) => setStripePaymentLink(e.target.value)} /></label>
            <label><span>Legacy PayPal link (optional)</span><input className="auth-input" placeholder="Leave blank for new stores" value={paypalUrl} onChange={(e) => setPaypalUrl(e.target.value)} /></label>
            <label><span>Legacy Venmo link (optional)</span><input className="auth-input" placeholder="Leave blank for new stores" value={venmoUrl} onChange={(e) => setVenmoUrl(e.target.value)} /></label>
            <label><span>Payment instructions</span><input className="auth-input" placeholder="Public customer-facing instructions only" value={paymentNote} onChange={(e) => setPaymentNote(e.target.value)} /></label>
          </div>
          <div className="settings-grid">
            <button className="wide-btn" disabled={busy === "settings"} onClick={() => void save(false)} type="button">{busy === "settings" ? "Saving..." : "Save private draft"}</button>
            <button className="wide-btn" disabled={busy === "settings"} onClick={() => void save(true)} type="button">{busy === "settings" ? "Saving..." : "Open storefront"}</button>
          </div>
          <p className="subtle" style={{ marginTop: ".75rem" }}>Never enter a secret key, webhook secret, password, bank account, login code, or other protected credential here.</p>
          {data.status === "active" ? <a className="wide-btn" href={liveUrl} target="_blank" rel="noreferrer"><ExternalLink size={16} /> Open verified storefront</a> : null}
        </section>

        <section className="panel panel-wide">
          <div className="panel-title"><Store size={20} /><div><h2>Product visibility</h2><p className="subtle">Visibility changes affect only the storefront product listing. They do not activate payments or bypass other launch gates.</p></div></div>
          {(data.products || []).length === 0 ? <div className="empty-state">No verified products are available for storefront visibility yet.</div> : data.products.map((product) => (
            <article className="settings-card" key={product.id} style={{ marginBottom: ".75rem" }}>
              <div className="panel-title panel-title-row">
                <div><strong>{product.name}</strong><p>${Number(product.base_price || 0).toFixed(2)} · {product.status}</p></div>
                <button className="icon-btn" disabled={Boolean(busy)} onClick={() => void toggleProduct(product)} type="button">
                  {product.status === "active" ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                  {busy === product.id ? "Saving..." : product.status === "active" ? "Hide product" : "Make visible"}
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
