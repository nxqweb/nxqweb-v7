import { useEffect, useMemo, useState } from "react";
import { Boxes, RefreshCcw } from "lucide-react";
import { CommerceNav } from "../components/CommerceNav";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

type InventoryItem = {
  product_id: string;
  product_name: string;
  variant_id: string;
  variant_title: string;
  sku: string | null;
  on_hand: number;
  reserved: number;
  incoming: number;
  available: number;
  low_stock_threshold: number;
  reorder_point: number;
  inventory_location: string | null;
  inventory_policy: string;
  is_low_stock: boolean;
  needs_reorder: boolean;
};

type InventoryResult = {
  summary?: { variants?: number; available_units?: number; low_stock?: number; needs_reorder?: number };
  items?: InventoryItem[];
};

export function ClientCommerceInventory() {
  const [inventory, setInventory] = useState<InventoryResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [adjustments, setAdjustments] = useState<Record<string, { delta: string; note: string }>>({});

  useEffect(() => { void loadInventory(); }, []);

  const items = useMemo(() => inventory?.items || [], [inventory]);
  const grouped = useMemo(() => items.reduce<Record<string, InventoryItem[]>>((acc, item) => {
    (acc[item.product_name] ||= []).push(item);
    return acc;
  }, {}), [items]);

  async function loadInventory() {
    setLoading(true); setError("");
    if (!isSupabaseConfigured || !supabase) { setError("Commerce inventory is unavailable because Supabase is not configured."); setLoading(false); return; }
    const session = await supabase.auth.getSession();
    if (!session.data.session) { window.location.replace("/portal/login"); return; }
    const result = await supabase.rpc("get_my_commerce_inventory");
    if (result.error) setError(`Inventory failed to load: ${result.error.message}`);
    else setInventory((result.data as InventoryResult) || null);
    setLoading(false);
  }

  async function adjust(item: InventoryItem) {
    if (!supabase) return;
    const draft = adjustments[item.variant_id] || { delta: "", note: "" };
    const delta = Number(draft.delta);
    if (!Number.isInteger(delta) || delta === 0) { setError("Enter a whole-number adjustment other than zero."); return; }
    setError(""); setMessage("");
    const result = await supabase.rpc("adjust_my_commerce_inventory", {
      variant_uuid: item.variant_id,
      quantity_delta: delta,
      adjustment_note: draft.note.trim() || null,
    });
    if (result.error) { setError(`Inventory could not be adjusted: ${result.error.message}`); return; }
    setMessage("Inventory adjusted and movement history recorded.");
    setAdjustments((current) => ({ ...current, [item.variant_id]: { delta: "", note: "" } }));
    await loadInventory();
  }

  const summary = inventory?.summary || {};

  return (
    <main className="nxq-page"><section className="portal-shell">
      <CommerceNav />
      <div className="panel-title panel-title-row"><div className="panel-title"><Boxes size={22} /><div><h1>Advanced inventory</h1><p className="subtle">Review every variant, stock warning, location, and guarded adjustment in one place.</p></div></div><button className="icon-btn" onClick={loadInventory} type="button"><RefreshCcw size={16} /> Refresh</button></div>
      {error ? <div className="auth-error">{error}</div> : null}
      {message ? <div className="auth-success">{message}</div> : null}
      <section className="panel panel-wide"><div className="settings-grid">
        <article className="settings-card"><span>Variants</span><strong>{summary.variants || 0}</strong><p>Active product variants.</p></article>
        <article className="settings-card"><span>Available units</span><strong>{summary.available_units || 0}</strong><p>On hand minus reserved.</p></article>
        <article className="settings-card"><span>Low stock</span><strong>{summary.low_stock || 0}</strong><p>At or below the warning threshold.</p></article>
        <article className="settings-card"><span>Needs reorder</span><strong>{summary.needs_reorder || 0}</strong><p>At or below the reorder point.</p></article>
      </div></section>
      {loading ? <div className="empty-state">Loading inventory...</div> : items.length === 0 ? <div className="empty-state">No product variants yet. Add products first.</div> : Object.entries(grouped).map(([productName, productItems]) => (
        <section className="panel panel-wide" key={productName}><h2>{productName}</h2>{productItems.map((item) => {
          const draft = adjustments[item.variant_id] || { delta: "", note: "" };
          return <article className="settings-card" key={item.variant_id} style={{ marginBottom: ".75rem" }}><div className="panel-title panel-title-row"><div><strong>{item.variant_title}</strong><p>{item.sku || "No SKU"} · {item.inventory_location || "No location"}</p></div><div><strong>{item.available} available</strong><p>{item.is_low_stock ? "Low stock" : "Stock healthy"}{item.needs_reorder ? " · Reorder needed" : ""}</p></div></div><div className="setup-form-grid"><div><span>On hand</span><strong>{item.on_hand}</strong></div><div><span>Reserved</span><strong>{item.reserved}</strong></div><div><span>Incoming</span><strong>{item.incoming}</strong></div><div><span>Sold out rule</span><strong>{item.inventory_policy === "continue" ? "Allow backorders" : "Stop selling"}</strong></div><label><span>Adjustment</span><input className="auth-input" placeholder="Example: 12 or -2" type="number" value={draft.delta} onChange={(e) => setAdjustments((current) => ({ ...current, [item.variant_id]: { ...draft, delta: e.target.value } }))} /></label><label><span>Reason</span><input className="auth-input" placeholder="Restock, damage, correction..." value={draft.note} onChange={(e) => setAdjustments((current) => ({ ...current, [item.variant_id]: { ...draft, note: e.target.value } }))} /></label></div><button className="wide-btn" type="button" onClick={() => adjust(item)}>Apply guarded adjustment</button></article>;
        })}</section>
      ))}
    </section></main>
  );
}
