import { useEffect, useState } from "react";
import { Copy, ExternalLink, Save, Store, ToggleLeft, ToggleRight, UserRound } from "lucide-react";
import { CommerceNav } from "../components/CommerceNav";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";
import { safePaymentUrl } from "../lib/safeUrl";
import { withCommerceReason } from "../lib/commerceRpcReason";

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
  const [loading, setLoading] = useState(true);
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState("");
  const [accountsOn, setAccountsOn] = useState<boolean | null>(null);
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
    setVerified(true);
    setLoading(false);
    const accounts = await supabase.rpc("get_public_store_accounts_status", { store_slug_value: next.store_slug });
    setAccountsOn(accounts.error ? null : Boolean((accounts.data as { accounts_enabled?: boolean } | null)?.accounts_enabled));
  }

  async function toggleAccounts() {
    if (!supabase || !verified || accountsOn === null) return;
    const turningOn = !accountsOn;
    const confirmed = window.confirm(turningOn
      ? "Let shoppers create accounts on your store? They can save their name, phone and address and see their order history. Guest checkout stays available. No card details are stored."
      : "Turn off shopper accounts? Shoppers will see guest checkout only. Saved details and order history are kept, not deleted.");
    if (!confirmed) return;
    setBusy("accounts");
    setError("");
    setMessage("");
    const result = await supabase.rpc("set_my_customer_accounts_enabled", { enable_accounts: turningOn });
    if (result.error) setError("Shopper accounts could not be changed right now. Nothing was changed.");
    else { setAccountsOn(turningOn); setMessage(turningOn ? "Shopper accounts are on." : "Shopper accounts are off."); }
    setBusy("");
  }

  async function save(makeLive: boolean) {
    if (!supabase || !verified || !data) return;

    if (makeLive) {
      const confirmed = window.confirm(
        "Open this storefront now? This can make the storefront publicly reachable, but it does not activate a payment provider or charge anyone."
      );
      if (!confirmed) return;
    }

    // Tell the store owner now if a payment link would be hidden on the public storefront.
    const badLink = (stripePaymentLink && !safePaymentUrl("stripe", stripePaymentLink) && "Stripe")
      || (paypalUrl && !safePaymentUrl("paypal", paypalUrl) && "PayPal")
      || (venmoUrl && !safePaymentUrl("venmo", venmoUrl) && "Venmo");
    if (badLink) {
      setError(`The ${badLink} link must be an https link on ${badLink}'s own website (for example buy.stripe.com, paypal.me or venmo.com). Nothing was saved.`);
      return;
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
        withCommerceReason(
          makeLive
            ? "Storefront activation could not be completed. The previously verified storefront state remains in place."
            : "Storefront settings could not be saved. The previously verified storefront state remains in place.",
          result.error
        )
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
    });

    if (result.error) {
      setError(withCommerceReason("Product visibility could not be changed. The previous verified product state remains in place.", result.error));
      setBusy("");
      return;
    }

    setMessage(`${product.name} is now ${makingLive ? "visible" : "hidden"} on the storefront.`);
    await load();
    setBusy("");
  }

  const liveUrl = data ? `${window.location.origin}${data.public_url}` : "";

  async function copyStoreLink() {
    try {
      await navigator.clipboard.writeText(liveUrl);
      setError("");
      setMessage("Store link copied.");
    } catch {
      setMessage("");
      setError("Could not copy automatically. Select the store address above and copy it by hand.");
    }
  }

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
          <p className="subtle" data-testid="payment-link-hint">You only need one payment link: Stripe, PayPal or Venmo. Fill in just the one you use and leave the others empty. PayPal and Venmo links carry the exact order total.</p>
          <div className="setup-form-grid">
            <label><span>Store name</span><input className="auth-input" value={storeName} onChange={(e) => setStoreName(e.target.value)} /></label>
            <label><span>Stripe Payment Link</span><input className="auth-input" placeholder="https://buy.stripe.com/... public link only" value={stripePaymentLink} onChange={(e) => setStripePaymentLink(e.target.value)} /></label>
            <label><span>PayPal link (optional)</span><input className="auth-input" placeholder="https://paypal.me/yourname" value={paypalUrl} onChange={(e) => setPaypalUrl(e.target.value)} /></label>
            <label><span>Venmo link (optional)</span><input className="auth-input" placeholder="https://venmo.com/u/yourname" value={venmoUrl} onChange={(e) => setVenmoUrl(e.target.value)} /></label>
            <label><span>Payment instructions</span><input className="auth-input" placeholder="Public customer-facing instructions only" value={paymentNote} onChange={(e) => setPaymentNote(e.target.value)} /></label>
          </div>
          <div className="settings-grid">
            <button className="wide-btn" disabled={busy === "settings"} onClick={() => void save(false)} type="button">{busy === "settings" ? "Saving..." : "Save private draft"}</button>
            <button className="wide-btn" disabled={busy === "settings"} onClick={() => void save(true)} type="button">{busy === "settings" ? "Saving..." : "Open storefront"}</button>
          </div>
          <p className="subtle" style={{ marginTop: ".75rem" }}>How amounts work: a Stripe Payment Link has its price set inside Stripe, and a store link cannot change it. If your orders can have different totals, create the link in Stripe with the option that lets customers choose what to pay (if your Stripe account offers it); customers are told the exact amount to enter. PayPal.me and Venmo links get each order's exact total added automatically. Every order number appears in your Orders page so you can match payments.</p>
          <p className="subtle" style={{ marginTop: ".75rem" }}>Never enter a Stripe secret key, webhook secret, password, bank account, login code, or other protected credential here. Only a public Stripe Payment Link (https://buy.stripe.com/...) belongs in this field.</p>
          {data.status === "active" ? <a className="wide-btn" href={liveUrl} target="_blank" rel="noreferrer"><ExternalLink size={16} /> Open verified storefront</a> : null}
          {data.status === "active" ? <div data-testid="store-link-box">
            <p className="subtle" style={{ marginTop: ".75rem" }}>Your store address: <strong>{liveUrl}</strong></p>
            <button className="icon-btn" type="button" onClick={() => void copyStoreLink()}><Copy size={16} /> Copy store link</button>
          </div> : null}
        </section>

        <section className="panel panel-wide">
          <div className="panel-title"><Store size={20} /><div><h2>Product visibility</h2><p className="subtle">Visibility changes affect only the storefront product listing. They do not activate payments or bypass other launch gates.</p></div></div>
          <p className="subtle">Photos are added on the <a href="/client/commerce/images">Photos page</a>, not here.</p>
          {(data.products || []).length === 0 ? <div className="empty-state">No verified products are available for storefront visibility yet.</div> : data.products.map((product) => (
            <article className="settings-card" key={product.id} style={{ marginBottom: ".75rem" }}>
              <div className="panel-title panel-title-row">
                <div><strong>{product.name}</strong><p>${Number(product.base_price || 0).toFixed(2)} · {product.status}</p></div>
                <button className="icon-btn" disabled={Boolean(busy)} onClick={() => void toggleProduct(product)} type="button">
                  {product.status === "active" ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                  {busy === product.id ? "Saving..." : product.status === "active" ? "Hide product" : "Make visible"}
                </button>
              </div>
            </article>
          ))}
        </section>

        <section className="panel panel-wide">
          <div className="panel-title panel-title-row">
            <div className="panel-title"><UserRound size={20} /><div><h2>Shopper accounts</h2><p className="subtle">Optional. Shoppers can create an account to save their details and see their orders. Guest checkout always stays available, and no card details are stored.</p></div></div>
            <button className="icon-btn" disabled={Boolean(busy) || accountsOn === null} onClick={() => void toggleAccounts()} type="button">
              {accountsOn ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
              {busy === "accounts" ? "Saving..." : accountsOn === null ? "Unavailable" : accountsOn ? "On (tap to turn off)" : "Off (tap to turn on)"}
            </button>
          </div>
          {data.status !== "active" ? <p className="subtle">Shoppers see this once your storefront is open.</p> : null}
        </section>
      </> : null}
    </section></main>
  );
}
