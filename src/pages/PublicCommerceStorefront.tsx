import { useEffect, useMemo, useRef, useState } from "react";
import { Minus, Plus, Share2, ShoppingCart, Store, Trash2 } from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";
import { safePaymentUrl } from "../lib/safeUrl";
import { orderPaymentHref } from "../lib/paymentLinks";
import { fetchShopperProfile, saveShopperProfile } from "../lib/shopperApi";
import { StoreCredit } from "../components/StoreCredit";
import { StoreProductCard } from "../components/store/StoreProductCard";
import { StoreProductDialog } from "../components/store/StoreProductDialog";
import { StoreSkeleton } from "../components/store/StoreSkeleton";
import { mailtoHref, metaDescription, profileFromRow, profileHasContent, socialHref, telHref, type StoreProfile } from "../lib/storeProfile";
import { mergeCheckoutAutofill, normalizeProfileInput, profileToCheckoutFields, shopperAccountPath, type ShopperProfileRow } from "../lib/shopperAccount";
import {
  addLine, cartCount, cartNeedsShipping, cartStorageKey, cartTotal, changeLine, firstSentence, formatMoney, friendlyCheckoutError, productHash, restoreCart, serializeCart, slugFromHash,
  stockLabel, validateCheckout, variantStock, type CartLine, type CheckoutErrors, type StoreProduct, type StoreVariant,
} from "../lib/storeCatalog";

type StoreData = { store: { name: string; slug: string; currency: string; stripe_payment_link?: string | null; paypal_url?: string | null; venmo_url?: string | null; payment_note?: string | null }; products: StoreProduct[] };
type OrderResult = { order_number: string; total: number; currency: string; stripe_payment_link?: string | null; paypal_url?: string | null; venmo_url?: string | null; payment_note?: string | null };

export function PublicCommerceStorefront() {
  const slug = window.location.pathname.split("/").filter(Boolean)[1] || "";
  const [data, setData] = useState<StoreData | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartReady, setCartReady] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "", address: "" });
  const [fieldErrors, setFieldErrors] = useState<CheckoutErrors>({});
  const [accountsEnabled, setAccountsEnabled] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [saveToAccount, setSaveToAccount] = useState(true);
  const [note, setNote] = useState("");
  const [order, setOrder] = useState<OrderResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [profile, setProfile] = useState<StoreProfile | null>(null);
  const [orderCopied, setOrderCopied] = useState(false);
  const [openSlug, setOpenSlug] = useState(() => slugFromHash(window.location.hash));
  const [toast, setToast] = useState("");
  const toastTimer = useRef<number | undefined>(undefined);

  const itemCount = useMemo(() => cartCount(cart), [cart]);
  const total = useMemo(() => cartTotal(cart), [cart]);
  const needsShipping = useMemo(() => cartNeedsShipping(cart), [cart]);
  const openProduct = useMemo(() => (openSlug && data ? data.products.find((p) => p.slug === openSlug) ?? null : null), [openSlug, data]);

  function showToast(message: string) {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 3500);
  }
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  async function load() {
    if (!isSupabaseConfigured || !supabase) { setError("Storefront is unavailable."); setLoading(false); return; }
    // The About block and the sign-in option do not depend on the store response, so they load alongside it (no late layout jump).
    void loadAccountHelp();
    void loadProfile();
    const result = await supabase.rpc("get_public_stripe_ready_commerce_storefront", { store_slug_value: slug });
    if (result.error || !result.data) setError("This storefront is not open yet.");
    else setData(result.data as StoreData);
    setLoading(false);
  }

  async function copyOrderNumber() {
    if (!order) return;
    try { await navigator.clipboard.writeText(order.order_number); setOrderCopied(true); window.setTimeout(() => setOrderCopied(false), 2500); }
    catch { setError("Could not copy automatically. Please write down your order number."); }
  }

  // Optional About and contact. Any failure (including the function not existing yet) just hides the block.
  async function loadProfile() {
    if (!supabase) return;
    try {
      const result = await supabase.rpc("get_public_store_profile", { store_slug_value: slug });
      if (result.error || !result.data) return;
      const next = profileFromRow(result.data);
      if (profileHasContent(next)) setProfile(next);
    } catch { /* the store works without it */ }
  }

  // Optional shopper accounts: never blocks guest checkout. Any failure here is ignored on purpose.
  async function loadAccountHelp() {
    if (!supabase) return;
    try {
      const status = await supabase.rpc("get_public_store_accounts_status", { store_slug_value: slug });
      if (!(status.data as { accounts_enabled?: boolean } | null)?.accounts_enabled) return;
      setAccountsEnabled(true);
      const session = await supabase.auth.getSession();
      if (!session.data.session) return;
      const profileResult = await fetchShopperProfile(slug);
      if (profileResult.error || !profileResult.data) return;
      setSignedIn(true);
      setForm((current) => mergeCheckoutAutofill(current, profileToCheckoutFields(profileResult.data as ShopperProfileRow)));
    } catch { /* guest checkout continues */ }
  }

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- storefront slug is fixed for this mounted route

  // The browser tab and shared links show the store's own name, not the NXQX app title.
  useEffect(() => {
    const name = data?.store.name;
    if (!name) return;
    const previous = document.title;
    document.title = name;
    return () => { document.title = previous; };
  }, [data?.store.name]);

  // Link previews and search results show a short summary of the shop when the owner wrote an About.
  useEffect(() => {
    const about = profile?.about;
    if (!about) return;
    let tag = document.querySelector('meta[name="description"]') as HTMLMetaElement | null;
    const created = !tag;
    const previous = tag?.getAttribute("content") ?? null;
    if (!tag) { tag = document.createElement("meta"); tag.setAttribute("name", "description"); document.head.appendChild(tag); }
    tag.setAttribute("content", metaDescription(about));
    return () => { if (created) tag?.remove(); else if (previous !== null) tag?.setAttribute("content", previous); };
  }, [profile?.about]);

  // The cart is remembered in this browser (ids and quantities only) so a refresh does not lose it. Prices and stock always come fresh from the store.
  useEffect(() => {
    if (!data || cartReady) return;
    try { setCart(restoreCart(window.localStorage.getItem(cartStorageKey(slug)), data.products)); } catch { /* private browsing: start with an empty cart */ }
    setCartReady(true);
  }, [data, cartReady, slug]);
  useEffect(() => {
    if (!cartReady) return;
    try { if (cart.length === 0) window.localStorage.removeItem(cartStorageKey(slug)); else window.localStorage.setItem(cartStorageKey(slug), serializeCart(cart)); } catch { /* cosmetic */ }
  }, [cart, cartReady, slug]);

  // A product link (#product-name) opens that product, and the browser's back button closes it.
  useEffect(() => {
    const onHash = () => setOpenSlug(slugFromHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  function openProductView(product: StoreProduct) {
    window.history.replaceState(null, "", productHash(product.slug));
    setOpenSlug(product.slug);
  }
  function closeProductView() {
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    setOpenSlug("");
  }

  function add(product: StoreProduct, variant: StoreVariant) {
    const result = addLine(cart, product, variant);
    setCart(result.cart);
    showToast(result.capped ? "That is all we have in stock right now." : `Added ${product.name} to your cart.`);
  }

  function changeQuantity(variantId: string, delta: number) {
    const result = changeLine(cart, variantId, delta);
    setCart(result.cart);
    if (result.capped) showToast("That is all we have in stock right now.");
  }

  async function shareStore() {
    if (!data) return;
    const url = `${window.location.origin}${window.location.pathname}`;
    try {
      if (typeof navigator.share === "function") await navigator.share({ title: data.store.name, url });
      else { await navigator.clipboard.writeText(url); showToast("Store link copied."); }
    } catch { /* the visitor closed the share sheet */ }
  }

  async function placeOrder() {
    if (!supabase || cart.length === 0) return;
    const problems = validateCheckout(form, needsShipping);
    setFieldErrors(problems);
    if (Object.keys(problems).length > 0) {
      setError("Please check the details marked below.");
      // Take the customer straight to the first box that needs attention.
      const first = (["name", "email", "address"] as const).find((key) => problems[key]);
      if (first) window.setTimeout(() => document.getElementById(`field-${first}`)?.focus(), 0);
      return;
    }
    setBusy(true); setError("");
    const result = await supabase.rpc("create_public_stripe_ready_direct_payment_order", {
      store_slug_value: slug,
      items_payload: cart.map((item) => ({ variant_id: item.variant.id, quantity: item.quantity })),
      customer_payload: {
        name: form.name,
        email: form.email,
        phone: form.phone,
        note,
        shipping_address: { address: form.address },
      },
    });
    if (result.error) setError(friendlyCheckoutError(result.error.message));
    else {
      setOrder(result.data as OrderResult);
      setCart([]);
      setToast("");
      if (signedIn && saveToAccount) {
        const saved = normalizeProfileInput({ fullName: form.name, phone: form.phone, address: form.address });
        if (saved.ok) await saveShopperProfile(slug, saved.payload);
      }
    }
    setBusy(false);
  }

  const setField = (key: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    if (key === "name" || key === "email" || key === "address") setFieldErrors((current) => ({ ...current, [key]: undefined }));
  };

  if (loading) return <StoreSkeleton />;
  if (!data) return <main className="nxq-page store-theme"><section className="portal-shell"><div className="auth-error" role="alert">{error || "Store unavailable."}</div><p className="subtle">If a shop gave you this link, please check back soon.</p></section></main>;

  const currency = data.store.currency;
  const tagline = profile?.about ? firstSentence(profile.about) : "Order directly from the shop.";

  return (
    <main className="nxq-page store-theme"><section className="portal-shell">
      <div className="panel-title panel-title-row store-header"><div className="panel-title"><Store size={24} /><div><h1>{data.store.name}</h1><p className="subtle">Secure order request · payment goes directly to this business</p></div></div><div>{accountsEnabled ? <a className="icon-btn" href={shopperAccountPath(slug)}>{signedIn ? "My account" : "Sign in"}</a> : null} <button className="icon-btn" type="button" onClick={() => void shareStore()} aria-label="Share this store"><Share2 size={16} /> Share</button> {!order ? <a className="store-cart-link" href="#store-cart" aria-label={`Cart, ${itemCount} ${itemCount === 1 ? "item" : "items"}`}><ShoppingCart size={20} /> {itemCount}</a> : null}</div></div>
      {error ? <div className="auth-error" role="alert">{error}</div> : null}

      {order ? <section className="panel panel-wide">
        <h2>Order {order.order_number} created</h2>
        <p>Your total is <strong>{formatMoney(order.total, order.currency)}</strong>.</p>
        <div className="notice-card"><strong>Payment step</strong><p>{order.payment_note || "Include your order number in the payment note."}</p><p>Use order number: <strong>{order.order_number}</strong></p></div>
        <ol className="store-next-steps" data-testid="store-next-steps">
          <li>Pay with the button below and put order number <strong>{order.order_number}</strong> in the payment note.</li>
          <li>The shop confirms your payment once it arrives in their account.</li>
          <li>Keep your order number. Use it if you contact the shop about this order.</li>
        </ol>
        <button className="icon-btn" type="button" onClick={() => void copyOrderNumber()}>{orderCopied ? "Order number copied" : "Copy order number"}</button>
        {(() => {
          const context = { orderNumber: order.order_number, total: Number(order.total), currency: order.currency, email: form.email };
          const stripeHref = orderPaymentHref("stripe", safePaymentUrl("stripe", order.stripe_payment_link), context);
          const paypalHref = orderPaymentHref("paypal", safePaymentUrl("paypal", order.paypal_url), context);
          const venmoHref = orderPaymentHref("venmo", safePaymentUrl("venmo", order.venmo_url), context);
          return <>
            <div className="settings-grid">
              {stripeHref ? <a className="wide-btn" href={stripeHref} target="_blank" rel="noreferrer">Continue to Stripe</a> : null}
              {paypalHref ? <a className="wide-btn" href={paypalHref} target="_blank" rel="noreferrer">Pay with PayPal</a> : null}
              {venmoHref ? <a className="wide-btn" href={venmoHref} target="_blank" rel="noreferrer">Pay with Venmo</a> : null}
            </div>
            {stripeHref ? <p className="subtle">On the payment page, please pay exactly {formatMoney(order.total, order.currency)} for order {order.order_number}.</p> : null}
          </>;
        })()}
        <p className="subtle">The business will confirm the payment after it arrives in their account.</p>
      </section> : <>
        {data.products.length > 0 ? <section className="store-hero" aria-label="Welcome" data-testid="store-hero">
          <p className="store-hero-text">{tagline}</p>
          <a className="wide-btn store-hero-cta" href="#products">Shop now</a>
        </section> : null}

        <section className="settings-grid store-product-grid" id="products" aria-label="Products">
          {data.products.length === 0 ? <div className="empty-state store-empty"><strong>Our shop is opening soon.</strong><p>New products are on the way. Please check back soon.</p></div>
            : data.products.map((product) => <StoreProductCard key={product.id} product={product} currency={currency} onOpen={openProductView} onAdd={add} />)}
        </section>

        <section className="panel panel-wide" id="store-cart" style={{ marginTop: "1rem" }}>
          <div className="panel-title"><ShoppingCart size={20} /><div><h2>Your cart</h2><p className="subtle">Prices are verified by the store before the order is created.</p></div></div>
          {cart.length === 0 ? <div className="empty-state">Your cart is empty.</div> : cart.map((item) => {
            const max = variantStock(item.variant).max;
            return <article className="settings-card store-cart-line" key={item.variant.id}>
              <div className="panel-title panel-title-row"><div><strong>{item.product.name}</strong><p>{item.variant.title !== "Default" ? item.variant.title : ""}</p></div><strong>{formatMoney(item.variant.price * item.quantity, currency)}</strong></div>
              <div className="store-qty-row">
                <button className="icon-btn" onClick={() => changeQuantity(item.variant.id, -1)} type="button" aria-label={`Fewer ${item.product.name}`}><Minus size={15} /></button>
                <span className="store-qty"><span className="sr-only">Quantity </span>{item.quantity}</span>
                <button className="icon-btn" onClick={() => changeQuantity(item.variant.id, 1)} type="button" aria-label={`More ${item.product.name}`} disabled={item.quantity >= max}><Plus size={15} /></button>
                <button className="icon-btn store-remove" onClick={() => changeQuantity(item.variant.id, -item.quantity)} type="button" aria-label={`Remove ${item.product.name} from the cart`}><Trash2 size={15} /> Remove</button>
                {stockLabel(item.variant).startsWith("Only") ? <span className="store-line-note">{stockLabel(item.variant)}</span> : null}
              </div>
            </article>;
          })}
          <h3>Total: {formatMoney(total, currency)}</h3>
        </section>

        {cart.length > 0 ? <form className="panel panel-wide" noValidate onSubmit={(event) => { event.preventDefault(); void placeOrder(); }}>
          <h2>Customer details</h2>
          <div className="setup-form-grid">
            <label><span>Name <em className="required-mark">(required)</em></span><input className="auth-input" id="field-name" autoComplete="name" value={form.name} aria-invalid={fieldErrors.name ? true : undefined} aria-describedby={fieldErrors.name ? "err-name" : undefined} onChange={(e) => setField("name", e.target.value)} />{fieldErrors.name ? <small className="store-field-error" id="err-name">{fieldErrors.name}</small> : null}</label>
            <label><span>Email <em className="required-mark">(required)</em></span><input className="auth-input" id="field-email" type="email" autoComplete="email" value={form.email} aria-invalid={fieldErrors.email ? true : undefined} aria-describedby={fieldErrors.email ? "err-email" : undefined} onChange={(e) => setField("email", e.target.value)} />{fieldErrors.email ? <small className="store-field-error" id="err-email">{fieldErrors.email}</small> : null}</label>
            <label><span>Phone <em className="optional-tag">(optional)</em></span><input className="auth-input" type="tel" autoComplete="tel" value={form.phone} onChange={(e) => setField("phone", e.target.value)} /></label>
            <label><span>Shipping address {needsShipping ? <em className="required-mark">(required)</em> : <em className="optional-tag">(not needed for pickup items)</em>}</span><input className="auth-input" id="field-address" autoComplete="street-address" value={form.address} aria-invalid={fieldErrors.address ? true : undefined} aria-describedby={fieldErrors.address ? "err-address" : undefined} onChange={(e) => setField("address", e.target.value)} />{fieldErrors.address ? <small className="store-field-error" id="err-address">{fieldErrors.address}</small> : null}</label>
          </div>
          <label><span>Order note <em className="optional-tag">(optional)</em></span><textarea className="auth-input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></label>
          {signedIn ? <label style={{ display: "flex", gap: ".6rem", alignItems: "center" }}><input type="checkbox" checked={saveToAccount} onChange={(e) => setSaveToAccount(e.target.checked)} /><span>Save these details to my account for next time</span></label> : null}
          <button className="wide-btn" disabled={busy} type="submit">{busy ? "Creating order..." : "Place order and continue to payment"}</button>
        </form> : null}
      </>}
      {!order && itemCount > 0 ? <a className="store-cart-bar" href="#store-cart" data-testid="store-cart-bar">View cart · {itemCount} {itemCount === 1 ? "item" : "items"} · {formatMoney(total, currency)}</a> : null}
      {profile ? <section className="store-about" data-testid="store-about" aria-label={`About ${data.store.name}`}>
        {profile.about ? <><h2>About us</h2><p className="store-about-text">{profile.about}</p></> : null}
        {mailtoHref(profile.contactEmail) || telHref(profile.contactPhone) || socialHref(profile.socialUrl) ? <ul className="store-contact-list">
          {mailtoHref(profile.contactEmail) ? <li>Email <a href={mailtoHref(profile.contactEmail)}>{profile.contactEmail}</a></li> : null}
          {telHref(profile.contactPhone) ? <li>Phone <a href={telHref(profile.contactPhone)}>{profile.contactPhone}</a></li> : null}
          {socialHref(profile.socialUrl) ? <li><a href={socialHref(profile.socialUrl)} target="_blank" rel="noopener noreferrer">Find us online</a></li> : null}
        </ul> : null}
      </section> : null}
      {openProduct && !order ? <StoreProductDialog key={openProduct.id} product={openProduct} currency={currency} onClose={closeProductView} onAdd={add} /> : null}
      <div className="store-toast" role="status" aria-live="polite" data-testid="store-toast">{toast}</div>
      <StoreCredit />
    </section></main>
  );
}
