import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, CircleAlert, RefreshCcw, Save, ShieldCheck, Truck } from "lucide-react";
import { CommerceNav } from "../components/CommerceNav";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

type ReadinessCheck = {
  key: string;
  label: string;
  passed: boolean;
  blocked?: boolean;
  note?: string;
};

type ReadinessData = {
  storefront?: {
    store_name?: string;
    status?: string;
    payment_mode?: string;
    shipping_mode?: string;
    tax_mode?: string;
  };
  settings?: Partial<ReadinessForm>;
  checks?: ReadinessCheck[];
  payment_blocked?: boolean;
  can_publish_without_payments?: boolean;
  notification_delivery_connected?: boolean;
  notification_events?: number;
};

type ReadinessForm = {
  shipping_regions: string;
  shipping_rates: string;
  pickup_enabled: boolean;
  pickup_instructions: string;
  tax_registration_confirmed: boolean;
  tax_notes: string;
  returns_policy: string;
  refund_policy: string;
  privacy_policy: string;
  terms_of_sale: string;
  support_email: string;
  customer_notifications_enabled: boolean;
};

const emptyForm: ReadinessForm = {
  shipping_regions: "",
  shipping_rates: "",
  pickup_enabled: false,
  pickup_instructions: "",
  tax_registration_confirmed: false,
  tax_notes: "",
  returns_policy: "",
  refund_policy: "",
  privacy_policy: "",
  terms_of_sale: "",
  support_email: "",
  customer_notifications_enabled: true,
};

export function ClientCommerceReadiness() {
  const [data, setData] = useState<ReadinessData | null>(null);
  const [form, setForm] = useState<ReadinessForm>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    void loadReadiness();
  }, []);

  async function loadReadiness() {
    setLoading(true);
    setError("");
    if (!isSupabaseConfigured || !supabase) {
      setError("Commerce readiness is unavailable because Supabase is not configured.");
      setLoading(false);
      return;
    }

    const sessionResult = await supabase.auth.getSession();
    if (!sessionResult.data.session) {
      window.location.replace("/portal/login");
      return;
    }

    const result = await supabase.rpc("get_my_commerce_launch_readiness");
    if (result.error) {
      setError(`Commerce readiness failed to load: ${result.error.message}`);
      setLoading(false);
      return;
    }

    const nextData = (result.data as ReadinessData) || {};
    setData(nextData);
    setForm({ ...emptyForm, ...(nextData.settings || {}) });
    setLoading(false);
  }

  function updateField<K extends keyof ReadinessForm>(key: K, value: ReadinessForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function saveReadiness() {
    if (!supabase) return;
    setSaving(true);
    setError("");
    setSuccess("");

    const result = await supabase.rpc("save_my_commerce_launch_readiness", {
      readiness_payload: form,
    });

    if (result.error) {
      setError(`Readiness settings could not be saved: ${result.error.message}`);
      setSaving(false);
      return;
    }

    setSuccess("Commerce launch-readiness settings saved.");
    setSaving(false);
    await loadReadiness();
  }

  const checks = data?.checks || [];
  const passedCount = useMemo(() => checks.filter((check) => check.passed).length, [checks]);
  const nonPaymentChecks = useMemo(() => checks.filter((check) => check.key !== "payment"), [checks]);
  const nonPaymentPassed = nonPaymentChecks.filter((check) => check.passed).length;

  return (
    <main className="nxq-page">
      <section className="portal-shell">
        <CommerceNav />

        <div className="panel-title panel-title-row">
          <div className="panel-title">
            <ShieldCheck size={24} />
            <div>
              <h1>Commerce launch readiness</h1>
              <p className="subtle">
                Finish shipping, pickup, tax preparation, store policies, and customer-support details before live payments are connected.
              </p>
            </div>
          </div>
          <button className="icon-btn" onClick={() => void loadReadiness()} type="button">
            <RefreshCcw size={16} /> Refresh
          </button>
        </div>

        {error ? <div className="auth-error">{error}</div> : null}
        {success ? <div className="notice-card success">{success}</div> : null}
        {loading ? <div className="empty-state">Loading launch readiness...</div> : null}

        {!loading ? (
          <>
            <section className="panel panel-wide">
              <div className="panel-title">
                <CheckCircle2 size={20} />
                <div>
                  <h2>Readiness checklist</h2>
                  <p className="subtle">
                    {nonPaymentPassed} of {nonPaymentChecks.length} non-payment checks complete. Payment stays intentionally blocked.
                  </p>
                </div>
              </div>

              <div className="settings-grid">
                {checks.map((check) => (
                  <article className="settings-card" key={check.key}>
                    <span>{check.label}</span>
                    <strong>{check.passed ? "Ready" : check.blocked ? "Blocked" : "Needs attention"}</strong>
                    <p>{check.note || (check.passed ? "This requirement is complete." : "Complete this before launch.")}</p>
                  </article>
                ))}
              </div>

              <div className="notice-card">
                <strong>{passedCount} of {checks.length} total checks complete</strong>
                <p>
                  Live storefront publication remains unavailable until a real payment provider is connected and separately approved.
                </p>
              </div>
            </section>

            <section className="panel panel-wide">
              <div className="panel-title">
                <Truck size={20} />
                <div>
                  <h2>Shipping and local pickup</h2>
                  <p className="subtle">Define where you deliver and how customers receive their orders.</p>
                </div>
              </div>

              <div className="setup-form-grid">
                <label>
                  Shipping regions
                  <textarea
                    value={form.shipping_regions}
                    onChange={(event) => updateField("shipping_regions", event.target.value)}
                    placeholder="Example: California and Nevada, or United States excluding Alaska and Hawaii"
                  />
                </label>
                <label>
                  Manual shipping rates
                  <textarea
                    value={form.shipping_rates}
                    onChange={(event) => updateField("shipping_rates", event.target.value)}
                    placeholder="Example: $8 standard, free over $75, oversized items quoted separately"
                  />
                </label>
                <label className="notice-card">
                  <input
                    checked={form.pickup_enabled}
                    onChange={(event) => updateField("pickup_enabled", event.target.checked)}
                    type="checkbox"
                  />
                  Enable local pickup
                </label>
                <label>
                  Pickup instructions
                  <textarea
                    value={form.pickup_instructions}
                    onChange={(event) => updateField("pickup_instructions", event.target.value)}
                    placeholder="Pickup address, hours, identification requirements, and notification instructions"
                  />
                </label>
              </div>
            </section>

            <section className="panel panel-wide">
              <div className="panel-title">
                <CircleAlert size={20} />
                <div>
                  <h2>Tax preparation</h2>
                  <p className="subtle">NXQ records your readiness notes but does not provide tax or legal advice.</p>
                </div>
              </div>

              <label className="notice-card">
                <input
                  checked={form.tax_registration_confirmed}
                  onChange={(event) => updateField("tax_registration_confirmed", event.target.checked)}
                  type="checkbox"
                />
                I have confirmed the business tax-registration and collection requirements with a qualified professional or government source.
              </label>
              <label>
                Tax notes
                <textarea
                  value={form.tax_notes}
                  onChange={(event) => updateField("tax_notes", event.target.value)}
                  placeholder="Jurisdictions, product exemptions, registration numbers kept outside NXQ, or questions for a professional"
                />
              </label>
            </section>

            <section className="panel panel-wide">
              <div className="panel-title">
                <ClipboardPolicyTitle />
              </div>
              <div className="setup-form-grid">
                <PolicyField label="Returns policy" value={form.returns_policy} onChange={(value) => updateField("returns_policy", value)} />
                <PolicyField label="Refund policy" value={form.refund_policy} onChange={(value) => updateField("refund_policy", value)} />
                <PolicyField label="Privacy policy" value={form.privacy_policy} onChange={(value) => updateField("privacy_policy", value)} />
                <PolicyField label="Terms of sale" value={form.terms_of_sale} onChange={(value) => updateField("terms_of_sale", value)} />
              </div>
            </section>

            <section className="panel panel-wide">
              <div className="panel-title">
                <ShieldCheck size={20} />
                <div>
                  <h2>Customer support and notification preparation</h2>
                  <p className="subtle">
                    Order-message records are prepared now, but no customer email is sent until a delivery provider is connected later.
                  </p>
                </div>
              </div>
              <div className="setup-form-grid">
                <label>
                  Customer support email
                  <input
                    type="email"
                    value={form.support_email}
                    onChange={(event) => updateField("support_email", event.target.value)}
                    placeholder="support@yourstore.com"
                  />
                </label>
                <label className="notice-card">
                  <input
                    checked={form.customer_notifications_enabled}
                    onChange={(event) => updateField("customer_notifications_enabled", event.target.checked)}
                    type="checkbox"
                  />
                  Prepare customer order-notification records
                </label>
              </div>
              <div className="notice-card">
                <strong>{data?.notification_events || 0} notification event records prepared</strong>
                <p>Email delivery connected: {data?.notification_delivery_connected ? "Yes" : "No — intentionally disabled"}</p>
              </div>
            </section>

            <button className="wide-btn" disabled={saving} onClick={() => void saveReadiness()} type="button">
              <Save size={17} /> {saving ? "Saving..." : "Save launch readiness"}
            </button>
          </>
        ) : null}
      </section>
    </main>
  );
}

function PolicyField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label>
      {label}
      <textarea value={value} onChange={(event) => onChange(event.target.value)} placeholder={`Write the store's ${label.toLowerCase()}.`} />
    </label>
  );
}

function ClipboardPolicyTitle() {
  return (
    <>
      <ShieldCheck size={20} />
      <div>
        <h2>Store policies</h2>
        <p className="subtle">Use business-specific policies reviewed for the store's location and products.</p>
      </div>
    </>
  );
}
