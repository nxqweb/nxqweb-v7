import { useEffect, useMemo, useRef, useState } from "react";
import { BadgeCheck, ChevronDown, Copy, PackageCheck, Plus, RefreshCcw, ShoppingBag } from "lucide-react";
import { CommerceNav } from "../components/CommerceNav";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";
import { formatMoneyIn as formatMoney } from "../lib/format";
import { deliveryBadge, deliveryById, deliveryColumns, hasDeliveryDetails, type OrderDelivery } from "../lib/orderDelivery";

type OrderItem = {
  id: string;
  product_name: string;
  variant_title: string | null;
  sku: string | null;
  quantity: number;
  unit_price: number;
  line_total: number;
};

type OrderEvent = {
  id: string;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  note: string | null;
  created_at: string;
};

type CommerceOrder = {
  id: string;
  order_number: string;
  customer_name: string;
  customer_email: string | null;
  currency: string;
  subtotal: number;
  total: number;
  payment_status: string;
  fulfillment_status: string;
  tracking_number: string | null;
  fulfillment_note: string | null;
  is_test: boolean;
  placed_at: string;
  updated_at: string;
  items: OrderItem[];
  events: OrderEvent[];
};

type OrdersResult = {
  summary?: { orders?: number; new_orders?: number; open_orders?: number; completed_orders?: number };
  orders?: CommerceOrder[];
};

const statusOptions = [
  ["new", "New"],
  ["processing", "Processing"],
  ["ready_for_pickup", "Ready for pickup"],
  ["shipped", "Shipped"],
  ["delivered", "Delivered"],
  ["cancelled", "Cancelled"],
  ["refunded", "Refunded"],
] as const;

function humanize(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function summaryValue(value: number | undefined, verified: boolean) {
  return verified && typeof value === "number" ? String(value) : "—";
}

export function ClientCommerceOrders() {
  const [data, setData] = useState<OrdersResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [drafts, setDrafts] = useState<Record<string, { status: string; tracking: string; note: string }>>({});

  // Where each order goes (address, phone, the shopper's note, pickup). Read separately so a failure never blocks the orders list.
  const [delivery, setDelivery] = useState<Record<string, OrderDelivery>>({});
  const [copiedAddress, setCopiedAddress] = useState("");

  useEffect(() => { void loadOrders(); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- loads once when the page opens

  async function loadDelivery() {
    if (!supabase) return;
    try {
      const result = await supabase.from("commerce_orders").select(deliveryColumns).order("created_at", { ascending: false }).limit(500);
      if (!result.error) setDelivery(deliveryById(result.data));
    } catch { /* the delivery block simply stays hidden */ }
  }

  async function copyAddress(orderId: string, address: string) {
    try { await navigator.clipboard.writeText(address); setCopiedAddress(orderId); window.setTimeout(() => setCopiedAddress(""), 2500); }
    catch { setError("Could not copy automatically. Please select the address and copy it."); }
  }

  const orders = useMemo(() => data?.orders || [], [data]);
  const summary = data?.summary || {};
  const sortedOrders = useMemo(() => [...orders].sort((a, b) => Date.parse(b.placed_at) - Date.parse(a.placed_at)), [orders]);

  const serverDrafts = useRef<Record<string, { status: string; tracking: string; note: string }>>({});
  async function loadOrders() {
    setLoading(true);
    setVerified(false);
    setError("");
    if (!isSupabaseConfigured || !supabase) {
      setData(null);
      setError("Commerce orders are temporarily unavailable. No order changes were made.");
      setLoading(false);
      return;
    }
    const session = await supabase.auth.getSession();
    if (!session.data.session) { window.location.replace("/portal/login"); return; }
    const result = await supabase.rpc("get_my_commerce_orders");
    if (result.error) {
      setData(null);
      setError("Orders could not be loaded right now. Please try again shortly.");
    } else {
      const next = (result.data as OrdersResult) || { orders: [], summary: {} };
      setData(next);
      setVerified(true);
      if ((next.orders || []).length > 0) void loadDelivery();
      // What the server holds now, per order. An order whose draft the owner has changed since the last load keeps what they typed (a refresh or saving ANOTHER
      // order must never wipe a tracking number or note that is still being typed); untouched drafts follow the server.
      const fresh: Record<string, { status: string; tracking: string; note: string }> = {};
      for (const order of next.orders || []) {
        fresh[order.id] = { status: order.fulfillment_status, tracking: order.tracking_number || "", note: order.fulfillment_note || "" };
      }
      const previousServer = serverDrafts.current;
      serverDrafts.current = fresh;
      setDrafts((current) => {
        const merged: Record<string, { status: string; tracking: string; note: string }> = {};
        for (const [id, value] of Object.entries(fresh)) {
          const typed = current[id]; const before = previousServer[id];
          merged[id] = typed && before && (typed.status !== before.status || typed.tracking !== before.tracking || typed.note !== before.note) ? typed : value;
        }
        return merged;
      });
    }
    setLoading(false);
  }

  async function createTestOrder() {
    if (!supabase || busy) return;
    setBusy("create"); setError(""); setMessage("");
    const result = await supabase.rpc("create_my_commerce_test_order");
    if (result.error) setError("The practice order could not be created. Nothing was charged and no customer was contacted.");
    else {
      const payload = result.data as { order_number?: string } | null;
      setMessage(`${payload?.order_number || "Practice order"} created. Nothing was charged and no customer was contacted.`);
      await loadOrders();
    }
    setBusy("");
  }

  async function confirmPayment(order: CommerceOrder) {
    if (!supabase || busy || order.payment_status === "paid") return;
    const confirmed = window.confirm(`Confirm that payment for ${order.order_number} was received outside this screen? This records the order as paid and may update inventory.`);
    if (!confirmed) return;
    setBusy(`pay-${order.id}`); setError(""); setMessage("");
    const result = await supabase.rpc("confirm_my_direct_payment_order", { order_uuid: order.id });
    if (result.error) setError("Payment status could not be confirmed. The previous order and inventory state were left unchanged.");
    else {
      setMessage(`${order.order_number} marked paid after your confirmation. Inventory was updated from the recorded order items.`);
      await loadOrders();
    }
    setBusy("");
  }

  async function saveOrder(order: CommerceOrder) {
    if (!supabase || busy) return;
    const draft = drafts[order.id] || { status: order.fulfillment_status, tracking: "", note: "" };
    setBusy(order.id); setError(""); setMessage("");
    const result = await supabase.rpc("update_my_commerce_order", {
      order_uuid: order.id,
      next_fulfillment_status: draft.status,
      tracking_value: draft.tracking.trim() || null,
      fulfillment_note_value: draft.note.trim() || null,
    });
    if (result.error) setError("Order could not be updated. The previous fulfillment state was left unchanged.");
    else {
      setMessage(`${order.order_number} updated and recorded in order history.`);
      await loadOrders();
    }
    setBusy("");
  }

  return (
    <main className="nxq-page"><section className="portal-shell">
      <CommerceNav />
      <div className="panel-title panel-title-row">
        <div className="panel-title" data-tour="orders-head"><ShoppingBag size={22} /><div><h1>Commerce orders</h1><p className="subtle">See your orders, confirm payments when the money arrives, and update shipping.</p></div></div>
        <button className="icon-btn" disabled={loading || Boolean(busy)} onClick={loadOrders} type="button"><RefreshCcw size={16} /> Refresh</button>
      </div>

      <section className="panel panel-wide">
        <div className="panel-title"><PackageCheck size={20} /><div><h2>Client-managed orders</h2><p className="subtle">Routine order updates stay in your portal. Payment confirmation here only records money you have independently verified as received; this screen does not charge a customer.</p></div></div>
        <button className="wide-btn" disabled={Boolean(busy)} onClick={createTestOrder} type="button"><Plus size={16} /> {busy === "create" ? "Creating practice order..." : "Create practice order"}</button>
        <p className="subtle" style={{ textAlign: "center", marginTop: ".75rem" }}>Testing only: no payment, email, shipment, provider activation, or live checkout is triggered.</p>
      </section>

      {error ? <div className="auth-error">{error}</div> : null}
      {message ? <div className="auth-success">{message}</div> : null}

      <section className="panel panel-wide"><div className="settings-grid">
        <article className="settings-card"><span>Total orders</span><strong>{summaryValue(summary.orders, verified)}</strong><p>All of your orders.</p></article>
        <article className="settings-card"><span>New</span><strong>{summaryValue(summary.new_orders, verified)}</strong><p>Orders waiting to be processed.</p></article>
        <article className="settings-card"><span>Open</span><strong>{summaryValue(summary.open_orders, verified)}</strong><p>Orders still being fulfilled.</p></article>
        <article className="settings-card"><span>Completed</span><strong>{summaryValue(summary.completed_orders, verified)}</strong><p>Orders marked delivered.</p></article>
      </div></section>

      {loading ? <div className="empty-state">Loading orders...</div> : verified && sortedOrders.length === 0 ? (
        <div className="empty-state">No orders yet. Place a practice order from your store, or press Create practice order above.</div>
      ) : verified ? sortedOrders.map((order) => {
        const draft = drafts[order.id] || { status: order.fulfillment_status, tracking: order.tracking_number || "", note: order.fulfillment_note || "" };
        const isOpen = Boolean(expanded[order.id]);
        const going = delivery[order.id];
        const badge = deliveryBadge(going);
        return (
          <section className="panel panel-wide" key={order.id}>
            <div className="panel-title panel-title-row">
              <div><h2>{order.order_number} {order.is_test ? <span className="subtle">· Test</span> : null}</h2><p>{order.customer_name}{order.customer_email ? ` · ${order.customer_email}` : ""}</p></div>
              <div style={{ textAlign: "right" }}><strong>{formatMoney(order.total, order.currency)}</strong><p>{humanize(order.fulfillment_status)} · {humanize(order.payment_status)}{badge ? ` · ${badge}` : ""}</p></div>
            </div>
            {order.payment_status !== "paid" && !order.is_test ? <button className="wide-btn" disabled={Boolean(busy)} onClick={() => void confirmPayment(order)} type="button"><BadgeCheck size={16} /> {busy === `pay-${order.id}` ? "Confirming..." : "Confirm payment received"}</button> : null}
            <button className="wide-btn" disabled={Boolean(busy)} onClick={() => setExpanded((current) => ({ ...current, [order.id]: !isOpen }))} type="button"><ChevronDown size={16} /> {isOpen ? "Hide order details" : "Open order details"}</button>
            {isOpen ? <div style={{ marginTop: "1rem" }}>
              <div className="settings-grid">
                <article className="settings-card"><span>Placed</span><strong>{new Date(order.placed_at).toLocaleString("en-US")}</strong></article>
                <article className="settings-card"><span>Payment</span><strong>{humanize(order.payment_status)}</strong></article>
              </div>
              {hasDeliveryDetails(going) ? <article className="settings-card" data-testid="order-delivery" style={{ marginTop: "1rem" }}>
                <span>{going.pickup ? "Pickup order" : "Send this order to"}</span>
                {going.pickup ? <strong>The customer will pick this up. No shipping needed.</strong> : null}
                {!going.pickup && going.address ? <><strong style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{going.address}</strong><button className="icon-btn" type="button" onClick={() => void copyAddress(order.id, going.address)}><Copy size={16} /> {copiedAddress === order.id ? "Copied" : "Copy address"}</button></> : null}
                {!going.pickup && !going.address ? <strong>No shipping address was given.</strong> : null}
                {going.phone ? <p>Phone: {going.phone}</p> : null}
                {going.shippingTotal > 0 ? <p>Shipping charged: {formatMoney(going.shippingTotal, order.currency)} (already in the total)</p> : null}
                {going.note ? <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>Customer's note: {going.note}</p> : null}
              </article> : null}
              <h3 style={{ marginTop: "1rem" }}>Items</h3>
              {order.items.map((item) => <article className="settings-card" key={item.id} style={{ marginBottom: ".75rem" }}><strong>{item.product_name}</strong><p>{item.variant_title || "Default"}{item.sku ? ` · ${item.sku}` : ""}</p><p>{item.quantity} × {formatMoney(item.unit_price, order.currency)} = {formatMoney(item.line_total, order.currency)}</p></article>)}
              <div className="setup-form-grid">
                <label><span>Fulfillment status</span><select className="auth-input" disabled={Boolean(busy)} value={draft.status} onChange={(e) => setDrafts((current) => ({ ...current, [order.id]: { ...draft, status: e.target.value } }))}>{statusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                <label><span>Tracking number</span><input className="auth-input" disabled={Boolean(busy)} placeholder="Optional tracking number" value={draft.tracking} onChange={(e) => setDrafts((current) => ({ ...current, [order.id]: { ...draft, tracking: e.target.value } }))} /></label>
              </div>
              <div className="setup-form-grid" style={{ gridTemplateColumns: "1fr" }}>
                <label><span>Fulfillment note</span><textarea className="auth-input" disabled={Boolean(busy)} placeholder="Pickup instructions, shipping note, cancellation reason..." rows={4} value={draft.note} onChange={(e) => setDrafts((current) => ({ ...current, [order.id]: { ...draft, note: e.target.value } }))} /></label>
              </div>
              <button className="wide-btn" disabled={Boolean(busy)} onClick={() => saveOrder(order)} type="button">{busy === order.id ? "Saving order..." : "Save order update"}</button>
              <h3 style={{ marginTop: "1.25rem" }}>Order history</h3>
              {order.events.length === 0 ? <div className="empty-state">No order history yet.</div> : order.events.map((event) => <article className="settings-card" key={event.id} style={{ marginBottom: ".75rem" }}><strong>{humanize(event.event_type)}</strong><p>{event.from_status ? `${humanize(event.from_status)} → ` : ""}{event.to_status ? humanize(event.to_status) : ""}</p>{event.note ? <p>{event.note}</p> : null}<p>{new Date(event.created_at).toLocaleString("en-US")}</p></article>)}
            </div> : null}
          </section>
        );
      }) : null}
    </section></main>
  );
}
