import { useEffect, useMemo, useState } from "react";
import { Minus, Plus, ShoppingCart, Store } from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

type Variant = { id: string; title: string; price: number; available_quantity: number; inventory_policy: string };
type Product = { id: string; name: string; slug: string; short_description?: string | null; description?: string | null; base_price: number; compare_at_price?: number | null; image_url?: string | null; variants: Variant[] };
type StoreData = { store: { name: string; slug: string; currency: string; paypal_url?: string | null; venmo_url?: string | null; payment_note?: string | null }; products: Product[] };
type CartItem = { product: Product; variant: Variant; quantity: number };
type OrderResult = { order_number: string; total: number; currency: string; paypal_url?: string | null; venmo_url?: string | null; payment_note?: string | null };

function money(value: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(value || 0));
}

export function PublicCommerceStorefront() {
  const slug = window.location.pathname.split("/").filter(Boolean)[1] || "";
  const [data, setData] = useState<StoreData | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [note, setNote] = useState("");
  const [order, setOrder] = useState<OrderResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const total = useMemo(() => cart.reduce((sum, item) => sum + Number(item.variant.price) * item.quantity, 0), [cart]);

  async function load() {
    if (!isSupabaseConfigured || !supabase) { setError("Storefront is unavailable."); setLoading(false); return; }
    const result = await supabase.rpc("get_public_commerce_storefront", { store_slug_value: slug });
    if (result.error || !result.data) setError("This storefront is not open yet.");
    else setData(result.data as StoreData);
    setLoading(false);
  }

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- storefront slug is fixed for this mounted route

  function add(product: Product, variant: Variant) {
    if (variant.inventory_policy === "deny" && variant.available_quantity <= 0) return;
    setCart((current) => {
      const existing = current.find((item) => item.variant.id === variant.id);
      if (existing) return current.map((item) => item.variant.id === variant.id ? { ...item, quantity: item.quantity + 1 } : item);
      return [...current, { product, variant, quantity: 1 }];
    });
  }

  function changeQuantity(variantId: string, delta: number) {
    setCart((current) => current.map((item) => item.variant.id === variantId ? { ...item, quantity: Math.max(0, item.quantity + delta) } : item).filter((item) => item.quantity > 0));
  }

  async function placeOrder() {
    if (!supabase || cart.length === 0) return;
    setBusy(true); setError("");
    const result = await supabase.rpc("create_public_direct_payment_order", {
      store_slug_value: slug,
      items_payload: cart.map((item) => ({ variant_id: item.variant.id, quantity: item.quantity })),
      customer_payload: {
        name,
        email,
        phone,
        note,
        shipping_address: { address },
      },
    });
    if (result.error) setError(result.error.message);
    else { setOrder(result.data as OrderResult); setCart([]); }
    setBusy(false);
  }

  if (loading) return <main className="nxq-page"><div className="empty-state">Loading store...</div></main>;
  if (!data) return <main className="nxq-page"><div className="auth-error">{error || "Store unavailable."}</div></main>;

  return (
    <main className="nxq-page"><section className="portal-shell">
      <div className="panel-title panel-title-row"><div className="panel-title"><Store size={24} /><div><h1>{data.store.name}</h1><p className="subtle">Secure order request · payment goes directly to this business</p></div></div><div><ShoppingCart size={20} /> {cart.reduce((sum, item) => sum + item.quantity, 0)}</div></div>
      {error ? <div className="auth-error">{error}</div> : null}

      {order ? <section className="panel panel-wide">
        <h2>Order {order.order_number} created</h2>
        <p>Your total is <strong>{money(order.total, order.currency)}</strong>.</p>
        <div className="notice-card"><strong>Payment step</strong><p>{order.payment_note || "Include your order number in the payment note."}</p><p>Use order number: <strong>{order.order_number}</strong></p></div>
        <div className="settings-grid">
          {order.paypal_url ? <a className="wide-btn" href={order.paypal_url} target="_blank" rel="noreferrer">Pay with PayPal</a> : null}
          {order.venmo_url ? <a className="wide-btn" href={order.venmo_url} target="_blank" rel="noreferrer">Pay with Venmo</a> : null}
        </div>
        <p className="subtle">The business will confirm the payment after it arrives in their account.</p>
      </section> : <>
        <section className="settings-grid">
          {data.products.length === 0 ? <div className="empty-state">No products are live yet.</div> : data.products.map((product) => {
            const variants = product.variants?.length ? product.variants : [{ id: product.id, title: "Default", price: product.base_price, available_quantity: 999, inventory_policy: "continue" }];
            return <article className="settings-card" key={product.id}>
              {product.image_url ? <img src={product.image_url} alt={product.name} style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "cover", borderRadius: "1rem", marginBottom: ".75rem" }} /> : null}
              <h2>{product.name}</h2>
              <p>{product.short_description || product.description || ""}</p>
              {variants.map((variant) => <div key={variant.id} style={{ marginTop: ".75rem" }}>
                <div className="panel-title panel-title-row"><span>{variant.title}</span><strong>{money(variant.price, data.store.currency)}</strong></div>
                <button className="wide-btn" type="button" disabled={variant.inventory_policy === "deny" && variant.available_quantity <= 0} onClick={() => add(product, variant)}>{variant.inventory_policy === "deny" && variant.available_quantity <= 0 ? "Sold out" : "Add to cart"}</button>
              </div>)}
            </article>;
          })}
        </section>

        <section className="panel panel-wide" style={{ marginTop: "1rem" }}>
          <div className="panel-title"><ShoppingCart size={20} /><div><h2>Your cart</h2><p className="subtle">Prices are verified by the store before the order is created.</p></div></div>
          {cart.length === 0 ? <div className="empty-state">Your cart is empty.</div> : cart.map((item) => <article className="settings-card" key={item.variant.id} style={{ marginBottom: ".75rem" }}>
            <div className="panel-title panel-title-row"><div><strong>{item.product.name}</strong><p>{item.variant.title}</p></div><strong>{money(item.variant.price * item.quantity, data.store.currency)}</strong></div>
            <div className="panel-title"><button className="icon-btn" onClick={() => changeQuantity(item.variant.id, -1)} type="button"><Minus size={15} /></button><span>{item.quantity}</span><button className="icon-btn" onClick={() => changeQuantity(item.variant.id, 1)} type="button"><Plus size={15} /></button></div>
          </article>)}
          <h3>Total: {money(total, data.store.currency)}</h3>
        </section>

        {cart.length > 0 ? <section className="panel panel-wide">
          <h2>Customer details</h2>
          <div className="setup-form-grid">
            <label><span>Name</span><input className="auth-input" value={name} onChange={(e) => setName(e.target.value)} /></label>
            <label><span>Email</span><input className="auth-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            <label><span>Phone</span><input className="auth-input" value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
            <label><span>Shipping address</span><input className="auth-input" value={address} onChange={(e) => setAddress(e.target.value)} /></label>
          </div>
          <label><span>Order note</span><textarea className="auth-input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></label>
          <button className="wide-btn" disabled={busy} onClick={() => void placeOrder()} type="button">{busy ? "Creating order..." : "Place order and continue to payment"}</button>
        </section> : null}
      </>}
    </section></main>
  );
}
