import { useEffect, useState } from "react";
import { Truck } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { checkShippingForm, noShipping, shippingFor, shippingFormFromRule, shippingRuleFromRow, type ShippingFormInput } from "../lib/storeShipping";

// The owner's shipping fee card on the Live store page (draft migration 08). It loads itself and shows NOTHING when the database does not
// have the shipping functions yet, so the page looks exactly as before until that migration is applied.
export function StoreShippingCard({ currency = "USD" }: { currency?: string }) {
  const [available, setAvailable] = useState(false);
  const [form, setForm] = useState<ShippingFormInput>(shippingFormFromRule(noShipping));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    void (async () => {
      if (!supabase) return;
      try {
        const result = await supabase.rpc("get_my_store_shipping");
        if (!live || result.error || !result.data) return;
        setForm(shippingFormFromRule(shippingRuleFromRow(result.data)));
        setAvailable(true);
      } catch { /* the card stays hidden */ }
    })();
    return () => { live = false; };
  }, []);

  if (!available) return null;

  const set = <K extends keyof ShippingFormInput>(key: K, value: ShippingFormInput[K]) => { setForm((current) => ({ ...current, [key]: value })); setMessage(""); setError(""); };
  const format = (amount: number) => { try { return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount); } catch { return `$${amount.toFixed(2)}`; } };
  const checked = checkShippingForm(form);
  let example = "";
  if (checked.ok && checked.args.mode_value === "flat") {
    const rule = shippingRuleFromRow({ mode: "flat", flat_fee: checked.args.flat_fee_value, free_over: checked.args.free_over_value, pickup_allowed: checked.args.pickup_allowed_value });
    const small = 20;
    const parts = [`A ${format(small)} order pays ${format(small + shippingFor(rule, small, true, "ship"))}.`];
    if (rule.freeOver !== null) parts.push(`Orders of ${format(rule.freeOver)} or more ship free.`);
    if (rule.pickupAllowed) parts.push("Pickup is always free.");
    example = parts.join(" ");
  }

  async function save() {
    if (!supabase || busy) return;
    if (!checked.ok) { setError(checked.message); return; }
    setBusy(true); setError(""); setMessage("");
    const result = await supabase.rpc("save_my_store_shipping", checked.args);
    if (result.error) setError(/between 0|above 0|300 characters|Choose no shipping/i.test(result.error.message) ? result.error.message : "The shipping fee could not be saved. Please try again.");
    else { setForm(shippingFormFromRule(shippingRuleFromRow(result.data))); setMessage("Shipping saved. New orders use it right away."); }
    setBusy(false);
  }

  return (
    <section className="panel panel-wide" data-testid="store-shipping-card">
      <div className="panel-title"><Truck size={20} /><div><h2>Shipping fee</h2><p className="subtle">Add one fee to every order that needs shipping. The store adds it to the customer's total for you.</p></div></div>
      <div className="setup-form-grid">
        <label><span>What do you charge for shipping?</span>
          <select className="auth-input" value={form.mode} onChange={(e) => set("mode", e.target.value)}>
            <option value="none">No shipping fee</option>
            <option value="flat">One flat fee per order</option>
          </select>
        </label>
        {form.mode === "flat" ? <label><span>Shipping fee <em className="required-mark">(required)</em></span><input className="auth-input" inputMode="decimal" placeholder="6.50" maxLength={10} value={form.flatFee} onChange={(e) => set("flatFee", e.target.value)} /></label> : null}
        {form.mode === "flat" ? <label><span>Free shipping on orders over <em className="optional-tag">(optional)</em></span><input className="auth-input" inputMode="decimal" placeholder="50" maxLength={10} value={form.freeOver} onChange={(e) => set("freeOver", e.target.value)} /></label> : null}
      </div>
      <label style={{ display: "flex", gap: ".6rem", alignItems: "center", minHeight: 44 }}><input type="checkbox" checked={form.pickupAllowed} onChange={(e) => set("pickupAllowed", e.target.checked)} /><span>Customers can pick up their order instead (free)</span></label>
      {form.pickupAllowed ? <label><span>Pickup details <em className="optional-tag">(optional)</em></span><input className="auth-input" maxLength={300} placeholder="Pickup is Saturdays at the market" value={form.pickupNote} onChange={(e) => set("pickupNote", e.target.value)} /></label> : null}
      {example ? <p className="subtle" data-testid="store-shipping-example">{example}</p> : null}
      {form.mode === "flat" ? <p className="subtle" data-testid="store-shipping-stripe-note">Using a Stripe Payment Link? A link with a fixed price cannot add shipping. Use PayPal or Venmo, or set the Stripe link so customers type the amount, and they will be told the exact total to pay.</p> : null}
      {error ? <div className="auth-error" role="alert">{error}</div> : null}
      {message ? <div className="notice-card" role="status">{message}</div> : null}
      <button className="wide-btn" type="button" disabled={busy} onClick={() => void save()}>{busy ? "Saving..." : "Save shipping"}</button>
    </section>
  );
}
