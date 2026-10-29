import { useEffect, useRef, useState } from "react";
import { Copy, ExternalLink, Save, Store, ToggleLeft, ToggleRight, UserRound } from "lucide-react";
import { CommerceNav } from "../components/CommerceNav";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";
import { safePaymentUrl } from "../lib/safeUrl";
import { withCommerceReason } from "../lib/commerceRpcReason";
import { emptyStoreProfile, normalizeStoreProfile, profileFromRow, storeProfileLimits, type StoreProfile } from "../lib/storeProfile";

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
  const [profile, setProfile] = useState<StoreProfile>(emptyStoreProfile);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const profileFetched = useRef(false);
  // How customers order: null means this database does not have the feature yet (the choice is simply not shown).
  const [orderMode, setOrderMode] = useState<"online" | "email" | "menu" | null>(null);
  const [orderChoice, setOrderChoice] = useState<"online" | "email" | "menu">("online");
  const [supportsMenu, setSupportsMenu] = useState(false);
  const modeFetched = useRef(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => { void load({ initial: true, resetFields: true }); }, []);

  // initial: the first load shows "Loading..." and starts clean. A refresh after a save or a product toggle keeps the page on screen (no flash, scroll position kept).
  // resetFields: only true when the values on screen should be replaced by what the server now holds (first load, or right after saving the payment settings).
  // A refresh after something else (a product toggle, the ordering choice) must NEVER replace a payment link or store name the owner is still typing.
  async function load({ initial, resetFields }: { initial: boolean; resetFields: boolean }) {
    if (initial) {
      setLoading(true);
      setVerified(false);
      setError("");
      setData(null);
    }

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
    if (resetFields) {
      setStoreName(next.store_name || "");
      setStripePaymentLink(next.stripe_payment_link || "");
      setPaypalUrl(next.paypal_url || "");
      setVenmoUrl(next.venmo_url || "");
      setPaymentNote(next.payment_note || "");
    }
    setVerified(true);
    setLoading(false);
    // The About and contact form is optional: if it cannot load, the rest of the page still works.
    // Fetched once: later reloads (after saving or making a product visible) must never replace text the owner is typing.
    if (!profileFetched.current) {
      const profileResult = await supabase.rpc("get_my_store_profile");
      if (!profileResult.error && profileResult.data) { setProfile(profileFromRow(profileResult.data)); setProfileLoaded(true); profileFetched.current = true; } else { setProfileLoaded(false); }
    }
    if (!modeFetched.current) {
      const modeResult = await supabase.rpc("get_my_store_order_mode");
      if (!modeResult.error && modeResult.data) {
        const info = modeResult.data as { order_mode?: string; supported_modes?: unknown };
        const mode = info.order_mode === "email" || info.order_mode === "menu" ? info.order_mode : "online";
        setOrderMode(mode); setOrderChoice(mode); modeFetched.current = true;
        // The Menu choice only appears once the database says it can handle it.
        setSupportsMenu(Array.isArray(info.supported_modes) && info.supported_modes.includes("menu"));
      }
    }
    const accounts = await supabase.rpc("get_public_store_accounts_status", { store_slug_value: next.store_slug });
    setAccountsOn(accounts.error ? null : Boolean((accounts.data as { accounts_enabled?: boolean } | null)?.accounts_enabled));
  }

  async function saveProfile() {
    if (!supabase || !verified || !profileLoaded) return;
    const check = normalizeStoreProfile(profile);
    if (!check.ok) { setMessage(""); setError(check.error); return; }
    setBusy("profile");
    setError("");
    setMessage("");
    const result = await supabase.rpc("save_my_store_profile", check.args);
    if (result.error) setError(withCommerceReason("Your About and contact details could not be saved. Nothing was changed.", result.error));
    else { setProfile(profileFromRow(result.data)); setMessage(data?.status === "active" ? "Saved. It now shows at the bottom of your store." : "Saved. It will show at the bottom of your store once the store is open."); }
    setBusy("");
  }

  async function saveOrderMode(makeLive: boolean) {
    if (!supabase || !verified || orderMode === null) return;
    if (orderChoice === "menu" && !profile.contactEmail.trim() && !profile.contactPhone.trim()) {
      setMessage("");
      setError("Type your contact email or phone in the About and contact box below and press Save About and contact first. Customers use it to order from your menu.");
      return;
    }
    if (orderChoice === "email" && !profile.contactEmail.trim()) {
      setMessage("");
      setError("Type your contact email in the About and contact box below and press Save About and contact first. Orders will be sent to that email.");
      return;
    }
    // An open store set to online ordering with no SAVED payment link would let shoppers fill a cart and then fail at checkout, so it is stopped here (typed but unsaved text does not count).
    if (orderChoice === "online" && (makeLive || data?.status === "active") && !data?.stripe_payment_link?.trim() && !data?.paypal_url?.trim() && !data?.venmo_url?.trim()) {
      setMessage("");
      setError("Online ordering needs a payment link first. Add your Stripe Payment Link (or PayPal or Venmo link) in the payment settings below and press Save private draft, then switch to online ordering.");
      return;
    }
    if (makeLive && !window.confirm(orderChoice === "menu" ? "Open your menu now? Customers will be able to see your items and prices, and call or email you to order. Nothing is charged online." : "Open this store now? Customers will be able to see it and send you orders by email. Nothing is charged online.")) return;
    setBusy("mode");
    setError("");
    setMessage("");
    const result = await supabase.rpc("save_my_store_order_mode", { order_mode_value: orderChoice, make_live: makeLive });
    if (result.error) setError(withCommerceReason("We could not save how customers order. Nothing was changed.", result.error));
    else {
      setOrderMode(orderChoice);
      setMessage(orderChoice === "menu" ? (makeLive ? "Your menu is open. Customers call or email you to order." : "Saved. Your menu will show once your store is open.") : orderChoice === "email" ? (makeLive ? "Your store is open. Customers send you their orders by email." : "Saved. Customers will send you their orders by email once your store is open.") : "Saved. Customers will pay online with your payment link.");
      await load({ initial: false, resetFields: false });
    }
    setBusy("");
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

    // In email mode saving the name must not close an open store (the save above puts a store without a payment link back to private).
    let reopened = false;
    if (!result.error && (orderMode === "email" || orderMode === "menu") && data.status === "active" && !makeLive) {
      reopened = true;
      const reopen = await supabase.rpc("save_my_store_order_mode", { order_mode_value: orderMode, make_live: true });
      if (reopen.error) { setError("Saved, but your store went back to private. Press Open my store in How do customers order?"); setBusy(""); await load({ initial: false, resetFields: true }); return; }
    }

    if (result.error) {
      setError(
        withCommerceReason(
          makeLive
            ? "We could not open your store. Nothing was changed."
            : "We could not save your store settings. Nothing was changed.",
          result.error
        )
      );
      setBusy("");
      return;
    }

    setMessage(
      makeLive
        ? "Your store is open. Customers can now order from it."
        : reopened
          ? "Saved. Your store is still open."
          : "Saved. Your store stays private until you press Open storefront."
    );
    await load({ initial: false, resetFields: true });
    setBusy("");
  }

  async function toggleProduct(product: LiveProduct) {
    if (!supabase || !verified) return;

    const makingLive = product.status !== "active";
    // A product left at $0 would be shown to customers for free, so say so before it goes live.
    const zeroPrice = makingLive && !(Number(product.base_price) > 0);
    const confirmed = window.confirm(
      zeroPrice
        ? `${product.name} has a price of $0, so customers would see it for free. Make it visible anyway? (You can set a price on the Products page first.)`
        : makingLive
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
    await load({ initial: false, resetFields: false });
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
      <div className="panel-title"><Store size={22} /><div><h1>Live storefront</h1><p className="subtle">Set your store name and payment link, open your store, and choose which products customers can see. This page never charges anyone or holds your money.</p></div></div>

      {error ? <div className="auth-error" role="alert">{error}</div> : null}
      {message ? <div className="auth-success">{message}</div> : null}
      {loading ? <div className="empty-state" role="status">Loading storefront settings...</div> : null}
      {!loading && !verified ? <div className="empty-state">Storefront settings could not be verified, so publishing controls are unavailable.</div> : null}

      {!loading && verified && data ? <>
        {orderMode !== null ? <section className="panel panel-wide" data-testid="order-mode-panel">
          <div className="panel-title"><Store size={20} /><div><h2>How do customers order?</h2><p className="subtle">Pick one. You can change it any time.</p></div></div>
          <div role="radiogroup" aria-label="How customers order" className="order-mode-choices">
            <label className="settings-card order-mode-option"><input type="radio" name="order-mode" checked={orderChoice === "online"} onChange={() => setOrderChoice("online")} /><span><strong>Online, with a payment link</strong><small>Customers place the order on your store, then pay with your Venmo, PayPal or Stripe link.</small></span></label>
            <label className="settings-card order-mode-option"><input type="radio" name="order-mode" checked={orderChoice === "email"} onChange={() => setOrderChoice("email")} /><span><strong>By email</strong><small>Customers fill in their cart and press Email my order. You get an email with everything and reply with how to pay. No payment link needed.</small></span></label>
            {supportsMenu ? <label className="settings-card order-mode-option"><input type="radio" name="order-mode" checked={orderChoice === "menu"} onChange={() => setOrderChoice("menu")} /><span><strong>Menu only</strong><small>Customers see your items, descriptions and prices, then call or email you to order. No cart, no stock to track. Put your opening hours in About and contact.</small></span></label> : null}
          </div>
          {orderChoice === "menu" ? <p className="subtle">Customers are told to contact you at your saved contact email or phone{profile.contactEmail.trim() || profile.contactPhone.trim() ? <>: <strong>{[profile.contactPhone.trim(), profile.contactEmail.trim()].filter(Boolean).join(" or ")}</strong></> : " (type them in About and contact below first)"}.</p> : null}
          {orderChoice === "email" ? <p className="subtle">Orders are sent to your contact email{profile.contactEmail.trim() ? <>: <strong>{profile.contactEmail.trim()}</strong></> : " (type it in About and contact below first)"}. Nothing is reserved in your stock until you confirm an order.</p> : null}
          <div className="settings-grid">
            <button className="wide-btn" disabled={Boolean(busy)} onClick={() => void saveOrderMode(false)} type="button">{busy === "mode" ? "Saving..." : "Save ordering choice"}</button>
            {orderChoice === "email" || orderChoice === "menu" ? <button className="wide-btn" disabled={Boolean(busy)} onClick={() => void saveOrderMode(true)} type="button">{busy === "mode" ? "Saving..." : orderChoice === "menu" ? "Open my menu" : "Open my store"}</button> : null}
          </div>
        </section> : null}

        <section className="panel panel-wide">
          <div className="panel-title"><Save size={20} /><div><h2>Store and payment handoff</h2><p className="subtle">A public payment link can be recorded here later, but this page does not create a payment account, store secrets, charge customers, or connect payouts.</p></div></div>
          {orderMode === "email" || orderMode === "menu" ? <p className="subtle">{orderMode === "menu" ? "Your menu does not take payments online, so no payment link is needed." : "Your store takes orders by email, so no payment link is needed."} Just set the store name.</p> : null}
          {orderMode === "email" || orderMode === "menu" ? null : <p className="subtle" data-testid="payment-link-hint">You only need one payment link: Stripe, PayPal or Venmo. Fill in just the one you use and leave the others empty. PayPal and Venmo links carry the exact order total.</p>}
          <div className="setup-form-grid">
            <label><span>Store name</span><input className="auth-input" value={storeName} onChange={(e) => setStoreName(e.target.value)} /></label>
            {orderMode === "email" || orderMode === "menu" ? null : <>
            <label><span>Stripe Payment Link</span><input className="auth-input" placeholder="https://buy.stripe.com/... public link only" value={stripePaymentLink} onChange={(e) => setStripePaymentLink(e.target.value)} /></label>
            <label><span>PayPal link (optional)</span><input className="auth-input" placeholder="https://paypal.me/yourname" value={paypalUrl} onChange={(e) => setPaypalUrl(e.target.value)} /></label>
            <label><span>Venmo link (optional)</span><input className="auth-input" placeholder="https://venmo.com/u/yourname" value={venmoUrl} onChange={(e) => setVenmoUrl(e.target.value)} /></label>
            <label><span>Payment instructions</span><input className="auth-input" placeholder="Public customer-facing instructions only" value={paymentNote} onChange={(e) => setPaymentNote(e.target.value)} /></label>
            </>}
          </div>
          <div className="settings-grid">
            <button className="wide-btn" disabled={Boolean(busy)} onClick={() => void save(false)} type="button">{busy === "settings" ? "Saving..." : "Save private draft"}</button>
            {orderMode === "email" || orderMode === "menu" ? null : <button className="wide-btn" disabled={Boolean(busy)} onClick={() => void save(true)} type="button">{busy === "settings" ? "Saving..." : "Open storefront"}</button>}
          </div>
          {orderMode === "email" || orderMode === "menu" ? null : <p className="subtle" style={{ marginTop: ".75rem" }}>How amounts work: a Stripe Payment Link has its price set inside Stripe, and a store link cannot change it. If your orders can have different totals, create the link in Stripe with the option that lets customers choose what to pay (if your Stripe account offers it); customers are told the exact amount to enter. PayPal.me and Venmo links get each order's exact total added automatically. Every order number appears in your Orders page so you can match payments.</p>}
          <p className="subtle" style={{ marginTop: ".75rem" }}>Never enter a Stripe secret key, webhook secret, password, bank account, login code, or other protected credential here. Only a public Stripe Payment Link (https://buy.stripe.com/...) belongs in this field.</p>
          {data.status === "active" ? <a className="wide-btn" href={liveUrl} target="_blank" rel="noreferrer"><ExternalLink size={16} /> Open verified storefront</a> : null}
          {data.status === "active" ? <div data-testid="store-link-box">
            <p className="subtle" style={{ marginTop: ".75rem" }}>Your store address: <strong>{liveUrl}</strong></p>
            <button className="icon-btn" type="button" onClick={() => void copyStoreLink()}><Copy size={16} /> Copy store link</button>
          </div> : null}
        </section>

        <section className="panel panel-wide">
          <div className="panel-title"><Store size={20} /><div><h2>Product visibility</h2><p className="subtle">Choose which products customers can see. A product stays hidden until you press Make visible.</p></div></div>
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

        {profileLoaded ? <section className="panel panel-wide" data-testid="store-profile-form">
          <div className="panel-title"><Store size={20} /><div><h2>About and contact <em className="optional-tag">optional</em></h2><p className="subtle">A short note and a way for customers to reach you. Whatever you type here is shown publicly at the bottom of your store, so leave a box empty to keep it private.</p></div></div>
          <label className="auth-label"><span>About your shop</span><textarea className="auth-input" rows={4} maxLength={storeProfileLimits.about} value={profile.about} onChange={(e) => setProfile((current) => ({ ...current, about: e.target.value }))} placeholder="Example: Small-batch candles and soap, hand-poured with essential oils." /></label>
          <p className="subtle">{profile.about.length} of {storeProfileLimits.about} characters</p>
          <div className="setup-form-grid">
            <label><span>Contact email</span><input className="auth-input" type="email" autoComplete="off" value={profile.contactEmail} onChange={(e) => setProfile((current) => ({ ...current, contactEmail: e.target.value }))} placeholder="you@example.com" /></label>
            <label><span>Contact phone</span><input className="auth-input" type="tel" autoComplete="off" value={profile.contactPhone} onChange={(e) => setProfile((current) => ({ ...current, contactPhone: e.target.value }))} placeholder="(555) 123-4567" /></label>
            <label><span>Instagram, Facebook or website link</span><input className="auth-input" autoComplete="off" value={profile.socialUrl} onChange={(e) => setProfile((current) => ({ ...current, socialUrl: e.target.value }))} placeholder="https://instagram.com/yourshop" /></label>
          </div>
          <button className="wide-btn" disabled={busy === "profile"} onClick={() => void saveProfile()} type="button">{busy === "profile" ? "Saving..." : "Save About and contact"}</button>
        </section> : null}

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
