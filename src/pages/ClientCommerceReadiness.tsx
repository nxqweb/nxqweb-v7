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

const twoColumnGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 310px), 1fr))",
  gap: "1rem",
  alignItems: "stretch",
} as const;

const fieldStyle = {
  display: "grid",
  gap: "0.55rem",
  minWidth: 0,
} as const;

const checkboxStyle = {
  display: "flex",
  alignItems: "flex-start",
  gap: "0.75rem",
  lineHeight: 1.5,
  textAlign: "left",
} as const;

export function ClientCommerceReadiness() {
  const [data, setData] = useState<ReadinessData | null>(null);
  const [form, setForm] = useState<ReadinessForm>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [verified, setVerified] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    void loadReadiness();
  }, []);

  async function loadReadiness(showLoading = true) {
    if (showLoading) setLoading(true);
    setError("");
    setSuccess("");
    setVerified(false);
    setData(null);

    if (!isSupabaseConfigured || !supabase) {
      setError("Commerce launch readiness is temporarily unavailable. No readiness settings were changed.");
      setLoading(false);
      return false;
    }

    const sessionResult = await supabase.auth.getSession();
    if (!sessionResult.data.session) {
      window.location.replace("/portal/login");
      return false;
    }

    const result = await supabase.rpc("get_my_commerce_launch_readiness");
    if (result.error) {
      setError("Commerce launch readiness could not be verified right now. Please try again shortly.");
      setLoading(false);
      return false;
    }

    const nextData = (result.data as ReadinessData) || {};
    setData(nextData);
    setForm({ ...emptyForm, ...(nextData.settings || {}) });
    setVerified(true);
    setLoading(false);
    return true;
  }

  function updateField<K extends keyof ReadinessForm>(key: K, value: ReadinessForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function saveReadiness() {
    if (!supabase || !verified || saving) return;
    setSaving(true);
    setError("");
    setSuccess("");

    const result = await supabase.rpc("save_my_commerce_launch_readiness", {
      readiness_payload: form,
    });

    if (result.error) {
      setError("Readiness settings could not be saved. The previously verified settings remain unchanged.");
      setSaving(false);
      return;
    }

    const reloaded = await loadReadiness(false);
    if (reloaded) {
      setSuccess("Commerce launch-readiness settings saved and re-verified.");
    }
    setSaving(false);
  }

  const checks = useMemo(() => (verified ? data?.checks || [] : []), [data, verified]);
  const passedCount = useMemo(() => checks.filter((check) => check.passed).length, [checks]);
  const nonPaymentChecks = useMemo(() => checks.filter((check) => check.key !== "payment"), [checks]);
  const nonPaymentPassed = nonPaymentChecks.filter((check) => check.passed).length;
  const hasReadinessData = verified && checks.length > 0;
  const notificationEventCount =
    typeof data?.notification_events === "number" ? String(data.notification_events) : "—";
  const notificationDeliveryLabel =
    typeof data?.notification_delivery_connected === "boolean"
      ? data.notification_delivery_connected
        ? "Yes"
        : "No — intentionally disabled"
      : "—";

  return (
    <main className="nxq-page">
      <section className="portal-shell">
        <CommerceNav />

        <div className="panel-title panel-title-row" style={{ alignItems: "flex-start", gap: "1rem" }}>
          <div className="panel-title" style={{ minWidth: 0 }}>
            <ShieldCheck size={24} />
            <div>
              <h1 style={{ lineHeight: 0.95 }}>Commerce launch readiness</h1>
              <p className="subtle">
                Finish shipping, pickup, tax preparation, store policies, and customer-support details before live payments are connected.
              </p>
            </div>
          </div>
          <button className="icon-btn" disabled={loading || saving} onClick={() => void loadReadiness()} type="button">
            <RefreshCcw size={16} /> Refresh
          </button>
        </div>

        {error ? <div className="auth-error" role="alert">{error}</div> : null}
        {success ? <div className="notice-card success">{success}</div> : null}
        {loading ? <div className="empty-state">Loading launch readiness...</div> : null}

        {!loading && !verified ? (
          <div className="empty-state">
            Launch-readiness data is not verified, so NXQ-Web is not showing or accepting readiness changes from this screen.
          </div>
        ) : null}

        {!loading && verified ? (
          <>
            <section className="panel panel-wide">
              <div className="panel-title">
                <CheckCircle2 size={20} />
                <div>
                  <h2>Readiness checklist</h2>
                  <p className="subtle">
                    {hasReadinessData
                      ? `${nonPaymentPassed} of ${nonPaymentChecks.length} non-payment checks complete. Payment stays intentionally blocked.`
                      : "Verified readiness data is available, but no checklist requirements were returned yet."}
                  </p>
                </div>
              </div>

              {hasReadinessData ? (
                <div className="settings-grid">
                  {checks.map((check) => (
                    <article className="settings-card" key={check.key}>
                      <span>{check.label}</span>
                      <strong>{check.passed ? "Ready" : check.blocked ? "Blocked" : "Needs attention"}</strong>
                      <p>{check.note || (check.passed ? "This requirement is complete." : "Complete this before launch.")}</p>
                    </article>
                  ))}
                </div>
              ) : null}

              <div className="notice-card">
                <strong>{hasReadinessData ? `${passedCount} of ${checks.length} total checks complete` : "No checklist rows returned"}</strong>
                <p>Live storefront publication and live payments remain separate guarded actions and are not activated by saving this form.</p>
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

              <div style={twoColumnGrid}>
                <Field label="Shipping regions">
                  <textarea
                    value={form.shipping_regions}
                    onChange={(event) => updateField("shipping_regions", event.target.value)}
                    placeholder="Example: California and Nevada, or United States excluding Alaska and Hawaii"
                  />
                </Field>
                <Field label="Manual shipping rates">
                  <textarea
                    value={form.shipping_rates}
                    onChange={(event) => updateField("shipping_rates", event.target.value)}
                    placeholder="Example: $8 standard, free over $75, oversized items quoted separately"
                  />
                </Field>
                <label className="notice-card" style={checkboxStyle}>
                  <input
                    checked={form.pickup_enabled}
                    onChange={(event) => updateField("pickup_enabled", event.target.checked)}
                    type="checkbox"
                    style={{ flex: "0 0 auto", marginTop: "0.2rem" }}
                  />
                  <span><strong>Enable local pickup</strong><br /><span className="subtle">Customers can collect orders using the instructions you provide.</span></span>
                </label>
                <Field label="Pickup instructions">
                  <textarea
                    value={form.pickup_instructions}
                    onChange={(event) => updateField("pickup_instructions", event.target.value)}
                    placeholder="Pickup address, hours, identification requirements, and notification instructions"
                  />
                </Field>
              </div>
            </section>

            <section className="panel panel-wide">
              <div className="panel-title">
                <CircleAlert size={20} />
                <div>
                  <h2>Tax preparation</h2>
                  <p className="subtle">NXQ records readiness notes but does not provide tax or legal advice.</p>
                </div>
              </div>

              <label className="notice-card" style={checkboxStyle}>
                <input
                  checked={form.tax_registration_confirmed}
                  onChange={(event) => updateField("tax_registration_confirmed", event.target.checked)}
                  type="checkbox"
                  style={{ flex: "0 0 auto", marginTop: "0.2rem" }}
                />
                <span>I have confirmed the business tax-registration and collection requirements with a qualified professional or government source.</span>
              </label>
              <Field label="Tax notes">
                <textarea
                  value={form.tax_notes}
                  onChange={(event) => updateField("tax_notes", event.target.value)}
                  placeholder="Jurisdictions, product exemptions, registration details kept outside NXQ, or questions for a professional"
                />
              </Field>
            </section>

            <section className="panel panel-wide">
              <div className="panel-title">
                <ShieldCheck size={20} />
                <div>
                  <h2>Store policies</h2>
                  <p className="subtle">Use business-specific policies reviewed for the store's location and products.</p>
                </div>
              </div>
              <div style={twoColumnGrid}>
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
                  <p className="subtle">Order-message records can be prepared here, but saving readiness does not send customer email or connect a delivery provider.</p>
                </div>
              </div>
              <div style={twoColumnGrid}>
                <Field label="Customer support email">
                  <input
                    type="email"
                    value={form.support_email}
                    onChange={(event) => updateField("support_email", event.target.value)}
                    placeholder="support@yourstore.com"
                  />
                </Field>
                <label className="notice-card" style={checkboxStyle}>
                  <input
                    checked={form.customer_notifications_enabled}
                    onChange={(event) => updateField("customer_notifications_enabled", event.target.checked)}
                    type="checkbox"
                    style={{ flex: "0 0 auto", marginTop: "0.2rem" }}
                  />
                  <span><strong>Prepare customer order-notification records</strong><br /><span className="subtle">Records only. Provider delivery remains separately gated.</span></span>
                </label>
              </div>
              <div className="notice-card">
                <strong>{notificationEventCount} notification event records prepared</strong>
                <p>Email delivery connected: {notificationDeliveryLabel}</p>
              </div>
            </section>

            <button className="wide-btn" disabled={saving || !verified} onClick={() => void saveReadiness()} type="button">
              <Save size={17} /> {saving ? "Saving..." : "Save launch readiness"}
            </button>
          </>
        ) : null}
      </section>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={fieldStyle}><span>{label}</span>{children}</label>;
}

function PolicyField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <Field label={label}>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={`Write the store's ${label.toLowerCase()}.`}
      />
    </Field>
  );
}
