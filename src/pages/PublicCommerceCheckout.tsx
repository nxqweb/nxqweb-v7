import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { ArrowLeft, CheckCircle2, Minus, Plus, ShieldCheck, ShoppingCart, Trash2 } from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

type CheckoutVariant = {
  id: string;
  title: string;
  sku?: string | null;
  price: number;
  available_quantity: number;
  inventory_policy: "deny" | "continue";
  is_default: boolean;
};

type CheckoutProduct = {
  id: string;
  name: string;
  short_description?: string | null;
  base_price: number;
  currency: string;
  category_name?: string | null;
  requires_shipping: boolean;
  track_inventory: boolean;
  variants: CheckoutVariant[];
};

type CheckoutData = {
  storefront: {
    store_name: string;
    store_slug: string;
    currency: string;
    locale: string;
    payment_mode: string;
    guest_checkout_enabled: boolean;
  };
  products: CheckoutProduct[];
  checkout_mode: "protected_test";
};

type CartLine = {
  product: CheckoutProduct;
  variant: CheckoutVariant;
  quantity: number;
};

type CheckoutResult = {
  order_number: string;
  total: number;
  currency: string;
  message?: string;
};

function formatMoney(value: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(value || 0));
}

function createIdempotencyKey() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `checkout-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function PublicCommerceCheckout() {
  const storeSlug = useMemo(() => new URLSearchParams(window.location.search).get("store")?.trim().toLowerCase() || "", []);
  const [data, setData] = useState<CheckoutData | null>(null);
  const [cart, setCart] = useState<Record<string, CartLine>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<CheckoutResult | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [city, setCity] = useState("");
  const [region, setRegion] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [country, setCountry] = useState("US");
  const [customerNote, setCustomerNote] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(createIdempotencyKey);

  useEffect(() => { void loadCheckout(); }, []);

  async function loadCheckout() {
    setLoading(true);
    setError("");
    if (!storeSlug) {
      setError("This protected checkout link is missing its storefront name.");
      setLoading(false);
      return;
    }
    if (!isSupabaseConfigured || !supabase) {
      setError("Protected checkout is unavailable because Supabase is not configured.");
      setLoading(false);
      return;
    }
    const result = await supabase.rpc("get_public_protected_commerce_checkout", { store_slug_input: storeSlug });
    if (result.error) setError(result.error.message);
    else setData(result.data as CheckoutData);
    setLoading(false);
  }

  const cartLines = Object.values(cart);
  const currency = data?.storefront.currency || "USD";
  const subtotal = cartLines.reduce((sum, line) => sum + line.variant.price * line.quantity, 0);
  const itemCount = cartLines.reduce((sum, line) => sum + line.quantity, 0);

  function addToCart(product: CheckoutProduct, variant: CheckoutVariant) {
    const key = variant.id;
    setSuccess(null);
    setError("");
    setCart((current) => {
      const existing = current[key];
      const maximum = product.track_inventory && variant.inventory_policy === "deny" ? variant.available_quantity : 99;
      if (maximum < 1) return current;
      const nextQuantity = Math.min((existing?.quantity || 0) + 1, maximum, 99);
      return { ...current, [key]: { product, variant, quantity: nextQuantity } };
    });
  }

  function changeQuantity(key: string, amount: number) {
    setCart((current) => {
      const line = current[key];
      if (!line) return current;
      const maximum = line.product.track_inventory && line.variant.inventory_policy === "deny" ? line.variant.available_quantity : 99;
      const nextQuantity = Math.min(line.quantity + amount, maximum, 99);
      if (nextQuantity < 1) {
        const next = { ...current };
        delete next[key];
        return next;
      }
      return { ...current, [key]: { ...line, quantity: nextQuantity } };
    });
  }

  async function submitCheckout(event: FormEvent) {
    event.preventDefault();
    if (!supabase || cartLines.length === 0) return;
    setSubmitting(true);
    setError("");
    setSuccess(null);

    const result = await supabase.rpc("create_public_protected_commerce_checkout", {
      store_slug_input: storeSlug,
      idempotency_key_input: idempotencyKey,
      checkout_payload: {
        customer_name: customerName,
        customer_email: customerEmail,
        customer_phone: customerPhone,
        shipping_method: "standard",
        customer_note: customerNote,
        shipping_address: {
          line1: addressLine1,
          line2: addressLine2,
          city,
          region,
          postal_code: postalCode,
          country,
        },
        items: cartLines.map((line) => ({
          product_id: line.product.id,
          variant_id: line.variant.id,
          quantity: line.quantity,
        })),
      },
    });

    setSubmitting(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }

    setSuccess(result.data as CheckoutResult);
    setCart({});
    setIdempotencyKey(createIdempotencyKey());
    await loadCheckout();
  }

  return (
    <main className="nxq-page">
      <section className="portal-shell">
        <a className="icon-btn" href={`/store/request?store=${encodeURIComponent(storeSlug)}`} style={{ width: "fit-content" }}><ArrowLeft size={16} /> Back to store request</a>
        <div className="panel-title panel-title-row">
          <div className="panel-title"><ShoppingCart size={24} /><div><h1>{data?.storefront.store_name || "Protected checkout"}</h1><p className="subtle">Add products to your cart and complete a test checkout without charging real money.</p></div></div>
          <div className="notice-card" style={{ margin: 0 }}><strong>{itemCount} item{itemCount === 1 ? "" : "s"}</strong></div>
        </div>

        <div className="notice-card" style={{ marginBottom: "1rem" }}>
          <ShieldCheck size={20} />
          <div><strong>Protected test checkout</strong><p>No real payment is charged, no email is sent, and no shipment is created. Prices and stock are verified securely by the server.</p></div>
        </div>

        {loading ? <div className="empty-state">Loading protected checkout...</div> : null}
        {error ? <div className="auth-error">{error}</div> : null}
        {success ? <div className="auth-success"><CheckCircle2 size={18} /><div><strong>{success.order_number} created</strong><p>{success.message || "Protected test checkout completed."} Total: {formatMoney(success.total, success.currency)}</p></div></div> : null}

        {!loading && data ? (
          <>
            <section className="panel panel-wide">
              <div className="panel-title"><ShoppingCart size={20} /><div><h2>Products</h2><p className="subtle">Choose an available product option. Checkout totals are recalculated on the server.</p></div></div>
              <div className="settings-grid">
                {data.products.map((product) => (
                  <article className="settings-card" key={product.id}>
                    <span>{product.category_name || "Product"}</span>
                    <strong>{product.name}</strong>
                    {product.short_description ? <p>{product.short_description}</p> : null}
                    <div style={{ display: "grid", gap: ".65rem", marginTop: ".8rem" }}>
                      {product.variants.map((variant) => {
                        const soldOut = product.track_inventory && variant.inventory_policy === "deny" && variant.available_quantity < 1;
                        return (
                          <button className="wide-btn" disabled={soldOut} key={variant.id} onClick={() => addToCart(product, variant)} type="button">
                            <Plus size={15} /> {variant.title} · {formatMoney(variant.price, product.currency)} · {soldOut ? "Out of stock" : `${variant.available_quantity} available`}
                          </button>
                        );
                      })}
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="panel panel-wide">
              <div className="panel-title"><ShoppingCart size={20} /><div><h2>Cart</h2><p className="subtle">The browser only holds your selections. Final pricing and stock checks happen on the server.</p></div></div>
              {cartLines.length === 0 ? <div className="empty-state">Your cart is empty.</div> : cartLines.map((line) => (
                <article className="settings-card" key={line.variant.id} style={{ marginBottom: ".75rem" }}>
                  <strong>{line.product.name}</strong><p>{line.variant.title} · {formatMoney(line.variant.price, currency)} each</p>
                  <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: ".65rem" }}>
                    <button className="icon-btn" onClick={() => changeQuantity(line.variant.id, -1)} type="button"><Minus size={15} /></button>
                    <strong>{line.quantity}</strong>
                    <button className="icon-btn" onClick={() => changeQuantity(line.variant.id, 1)} type="button"><Plus size={15} /></button>
                    <button className="icon-btn" onClick={() => setCart((current) => { const next = { ...current }; delete next[line.variant.id]; return next; })} type="button"><Trash2 size={15} /> Remove</button>
                    <strong style={{ marginLeft: "auto" }}>{formatMoney(line.variant.price * line.quantity, currency)}</strong>
                  </div>
                </article>
              ))}
              <div className="settings-card"><span>Protected test total</span><strong>{formatMoney(subtotal, currency)}</strong><p>Shipping and tax remain $0.00 during this protected foundation phase.</p></div>
            </section>

            <form className="panel panel-wide" onSubmit={(event) => void submitCheckout(event)}>
              <div className="panel-title"><ShieldCheck size={20} /><div><h2>Customer and delivery details</h2><p className="subtle">These details are saved only with the protected test order.</p></div></div>
              <div className="setup-form-grid">
                <label><span>Name</span><input className="auth-input" value={customerName} onChange={(event) => setCustomerName(event.target.value)} maxLength={160} required /></label>
                <label><span>Email</span><input className="auth-input" type="email" value={customerEmail} onChange={(event) => setCustomerEmail(event.target.value)} maxLength={200} required /></label>
                <label><span>Phone (optional)</span><input className="auth-input" value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} maxLength={40} /></label>
                <label><span>Country</span><input className="auth-input" value={country} onChange={(event) => setCountry(event.target.value.toUpperCase())} maxLength={2} required /></label>
                <label><span>Address line 1</span><input className="auth-input" value={addressLine1} onChange={(event) => setAddressLine1(event.target.value)} maxLength={200} required /></label>
                <label><span>Address line 2 (optional)</span><input className="auth-input" value={addressLine2} onChange={(event) => setAddressLine2(event.target.value)} maxLength={200} /></label>
                <label><span>City</span><input className="auth-input" value={city} onChange={(event) => setCity(event.target.value)} maxLength={120} required /></label>
                <label><span>State or region</span><input className="auth-input" value={region} onChange={(event) => setRegion(event.target.value)} maxLength={120} required /></label>
                <label><span>Postal code</span><input className="auth-input" value={postalCode} onChange={(event) => setPostalCode(event.target.value)} maxLength={30} required /></label>
              </div>
              <label><span>Order note (optional)</span><textarea className="auth-input" rows={4} value={customerNote} onChange={(event) => setCustomerNote(event.target.value)} maxLength={1000} placeholder="Delivery instructions or other notes" /></label>
              <button className="wide-btn" disabled={submitting || cartLines.length === 0} type="submit"><ShieldCheck size={17} /> {submitting ? "Completing protected checkout..." : `Complete protected test checkout · ${formatMoney(subtotal, currency)}`}</button>
            </form>
          </>
        ) : null}
      </section>
    </main>
  );
}
