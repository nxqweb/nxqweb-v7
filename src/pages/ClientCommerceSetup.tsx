import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, MonitorPlay, Save, ShoppingBag } from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

type CommerceIntake = {
  id?: string;
  status?: string;
  store_name: string;
  business_model: string;
  product_count_range: string;
  product_types: string;
  category_plan: string;
  inventory_method: string;
  low_stock_rules: string;
  fulfillment_methods: string[];
  shipping_regions: string;
  local_pickup_details: string;
  tax_requirements: string;
  customer_accounts_preference: string;
  guest_checkout_preference: boolean;
  returns_policy: string;
  refund_policy: string;
  payment_requirements: string;
  requested_payment_provider: string;
  current_store_url: string;
  product_data_source: string;
  integrations: string;
  storefront_style: string;
  brand_assets_notes: string;
  required_pages: string;
  special_features: string;
  launch_priority: string;
  additional_notes: string;
  existing_site_detected?: boolean;
  detected_site_url?: string | null;
  detected_site_source?: string | null;
  website_transition_mode: string;
  scroll_behavior: string;
  animation_intensity: string;
  section_reveal_style: string;
  page_transition_style: string;
  product_card_hover_style: string;
  layout_style: string;
  parallax_enabled: boolean;
  sticky_sections_enabled: boolean;
  horizontal_scroll_enabled: boolean;
  reduce_motion_mobile: boolean;
  inspiration_urls: string;
  animation_notes: string;
};

const initialIntake: CommerceIntake = {
  store_name: "",
  business_model: "physical_products",
  product_count_range: "",
  product_types: "",
  category_plan: "",
  inventory_method: "track_inventory",
  low_stock_rules: "",
  fulfillment_methods: [],
  shipping_regions: "",
  local_pickup_details: "",
  tax_requirements: "",
  customer_accounts_preference: "optional",
  guest_checkout_preference: true,
  returns_policy: "",
  refund_policy: "",
  payment_requirements: "",
  requested_payment_provider: "",
  current_store_url: "",
  product_data_source: "",
  integrations: "",
  storefront_style: "",
  brand_assets_notes: "",
  required_pages: "",
  special_features: "",
  launch_priority: "",
  additional_notes: "",
  website_transition_mode: "not_selected",
  scroll_behavior: "smooth",
  animation_intensity: "balanced",
  section_reveal_style: "fade_up",
  page_transition_style: "fade",
  product_card_hover_style: "lift",
  layout_style: "modern_grid",
  parallax_enabled: false,
  sticky_sections_enabled: false,
  horizontal_scroll_enabled: false,
  reduce_motion_mobile: true,
  inspiration_urls: "",
  animation_notes: "",
};

const fulfillmentOptions = [
  ["shipping", "Shipping"],
  ["local_pickup", "Local pickup"],
  ["local_delivery", "Local delivery"],
  ["digital_delivery", "Digital delivery"],
] as const;

const transitionOptions = [
  ["new_build", "Build a completely new website"],
  ["replace_existing", "Replace the current website after preview approval"],
  ["rebuild_with_existing_content", "Rebuild using selected existing content"],
  ["connect_existing_supported_site", "Connect and manage the existing supported website"],
  ["nxq_review", "Let NXQ review and recommend the safest path"],
] as const;

export function ClientCommerceSetup() {
  const [intake, setIntake] = useState<CommerceIntake>(initialIntake);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [verified, setVerified] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    void loadIntake();
  }, []);

  const isLocked = useMemo(
    () => intake.status === "approved" || intake.status === "archived",
    [intake.status]
  );

  async function loadIntake() {
    setLoading(true);
    setVerified(false);
    setError("");

    if (!isSupabaseConfigured || !supabase) {
      setError("Commerce setup is temporarily unavailable.");
      setLoading(false);
      return;
    }

    const sessionResult = await supabase.auth.getSession();
    if (!sessionResult.data.session) {
      window.location.replace("/portal/login");
      return;
    }

    const result = await supabase.rpc("get_my_commerce_intake");
    if (result.error) {
      setError("Commerce setup could not be verified right now. Unverified setup fields are not shown.");
    } else {
      setIntake({ ...initialIntake, ...((result.data || {}) as Partial<CommerceIntake>) });
      setVerified(true);
    }

    setLoading(false);
  }

  function updateField<K extends keyof CommerceIntake>(key: K, value: CommerceIntake[K]) {
    setIntake((current) => ({ ...current, [key]: value }));
  }

  function toggleFulfillment(value: string) {
    setIntake((current) => ({
      ...current,
      fulfillment_methods: current.fulfillment_methods.includes(value)
        ? current.fulfillment_methods.filter((method) => method !== value)
        : [...current.fulfillment_methods, value],
    }));
  }

  async function saveIntake(submitForReview: boolean) {
    if (!supabase || isLocked || saving || !verified) return;

    if (submitForReview && !intake.store_name.trim()) {
      setError("Enter the store name before submitting for review.");
      return;
    }

    if (submitForReview && intake.website_transition_mode === "not_selected") {
      setError("Choose how NXQ should handle the current website before submitting.");
      return;
    }

    setSaving(true);
    setMessage("");
    setError("");

    const payload = { ...intake };
    delete payload.id;
    delete payload.status;

    const result = await supabase.rpc("save_my_commerce_intake", {
      intake_payload: payload,
      submit_for_review: submitForReview,
    });

    setSaving(false);

    if (result.error) {
      setError(submitForReview
        ? "Commerce setup could not be submitted. Nothing was published, activated, or sent to production."
        : "Commerce setup could not be saved. Your previously saved setup remains unchanged.");
      return;
    }

    const response = result.data as { status?: string; message?: string } | null;
    setIntake((current) => ({ ...current, status: response?.status || current.status }));
    setMessage(submitForReview ? "Commerce setup submitted for NXQ review." : "Commerce setup draft saved.");
  }

  return (
    <main className="nxq-page">
      <section className="portal-shell">
        <div className="panel-title panel-title-row">
          <div className="panel-title">
            <ShoppingBag size={22} />
            <div>
              <h1>NXQ-Commerce setup</h1>
              <p className="subtle">Define the storefront, migration path, motion, checkout, and fulfillment before the build starts.</p>
            </div>
          </div>
          <a className="icon-btn" href="/client/commerce"><ArrowLeft size={16} /> Back to Commerce</a>
        </div>

        <div className="notice-card">Saving or submitting this form does not publish a store, activate payments, change your plan, or bypass owner and production safety gates.</div>
        {error ? <div className="auth-error" role="alert">{error}</div> : null}
        {message ? <div className="auth-success">{message}</div> : null}
        {loading ? <div className="empty-state">Loading Commerce setup...</div> : null}

        {!loading && verified ? (
          <div className="owner-detail-grid">
            <section className="panel panel-wide">
              <div className="panel-title"><ShoppingBag size={20} /><div><h2>Store basics</h2><p className="subtle">Start with what you sell and how the catalog should be organized.</p></div></div>
              <div className="setup-form-grid">
                <label><span>Store name</span><input className="auth-input" value={intake.store_name} disabled={isLocked} onChange={(event) => updateField("store_name", event.target.value)} placeholder="Example: Hale Peak Supply" /></label>
                <label><span>Business model</span><select className="auth-input" value={intake.business_model} disabled={isLocked} onChange={(event) => updateField("business_model", event.target.value)}><option value="physical_products">Physical products</option><option value="digital_products">Digital products</option><option value="services">Services sold online</option><option value="mixed">Mixed products and services</option></select></label>
                <label><span>Approximate product count</span><input className="auth-input" value={intake.product_count_range} disabled={isLocked} onChange={(event) => updateField("product_count_range", event.target.value)} placeholder="Example: 25-50 products" /></label>
                <label><span>Inventory method</span><select className="auth-input" value={intake.inventory_method} disabled={isLocked} onChange={(event) => updateField("inventory_method", event.target.value)}><option value="track_inventory">Track exact inventory</option><option value="made_to_order">Made to order</option><option value="unlimited">Unlimited inventory</option><option value="not_sure">Not sure yet</option></select></label>
              </div>
              <label className="auth-label"><span>What products or services will you sell?</span><textarea className="auth-input" rows={4} value={intake.product_types} disabled={isLocked} onChange={(event) => updateField("product_types", event.target.value)} /></label>
              <label className="auth-label"><span>Category plan</span><textarea className="auth-input" rows={3} value={intake.category_plan} disabled={isLocked} onChange={(event) => updateField("category_plan", event.target.value)} placeholder="List the main categories and any subcategories." /></label>
              <label className="auth-label"><span>Low-stock and backorder rules</span><textarea className="auth-input" rows={3} value={intake.low_stock_rules} disabled={isLocked} onChange={(event) => updateField("low_stock_rules", event.target.value)} /></label>
            </section>

            <section className="panel panel-wide">
              <div className="panel-title"><MonitorPlay size={20} /><div><h2>Existing website and migration</h2><p className="subtle">NXQ detected what it could from the account. Choose the safest transition path.</p></div></div>
              {intake.existing_site_detected && intake.detected_site_url ? <div className="notice-card success"><strong>Existing website detected automatically</strong><p>{intake.detected_site_url}</p><p className="subtle">Found from {(intake.detected_site_source || "account data").replaceAll("_", " ")}.</p></div> : <div className="notice-card">No reliable website was detected from the client profile, domain records, or monitoring data.</div>}
              <label className="auth-label"><span>How should NXQ handle the website?</span><select className="auth-input" value={intake.website_transition_mode} disabled={isLocked} onChange={(event) => updateField("website_transition_mode", event.target.value)}><option value="not_selected">Choose a transition path</option>{transitionOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label className="auth-label"><span>Current store URL</span><input className="auth-input" value={intake.current_store_url} disabled={isLocked} onChange={(event) => updateField("current_store_url", event.target.value)} placeholder="Only needed when NXQ could not detect it" /></label>
              <label className="auth-label"><span>Where is your product data now?</span><textarea className="auth-input" rows={3} value={intake.product_data_source} disabled={isLocked} onChange={(event) => updateField("product_data_source", event.target.value)} placeholder="Spreadsheet, Shopify, Square, handwritten list, etc." /></label>
            </section>

            <section className="panel panel-wide">
              <div className="panel-title"><MonitorPlay size={20} /><div><h2>Storefront design and motion</h2><p className="subtle">Choose the default visual system. NXQ can refine it during review.</p></div></div>
              <div className="setup-form-grid">
                <label><span>Layout style</span><select className="auth-input" value={intake.layout_style} disabled={isLocked} onChange={(event) => updateField("layout_style", event.target.value)}><option value="modern_grid">Modern product grid</option><option value="editorial">Editorial / story-led</option><option value="minimal">Minimal</option><option value="luxury">Luxury</option><option value="bold">Bold / high-energy</option><option value="custom">Custom direction</option></select></label>
                <label><span>Scroll behavior</span><select className="auth-input" value={intake.scroll_behavior} disabled={isLocked} onChange={(event) => updateField("scroll_behavior", event.target.value)}><option value="standard">Standard scrolling</option><option value="smooth">Smooth scrolling</option><option value="section_snap">Section snap</option><option value="custom">Custom scrolling</option></select></label>
                <label><span>Animation intensity</span><select className="auth-input" value={intake.animation_intensity} disabled={isLocked} onChange={(event) => updateField("animation_intensity", event.target.value)}><option value="none">None</option><option value="subtle">Subtle</option><option value="balanced">Balanced</option><option value="cinematic">Cinematic</option><option value="custom">Custom</option></select></label>
                <label><span>Section reveal</span><select className="auth-input" value={intake.section_reveal_style} disabled={isLocked} onChange={(event) => updateField("section_reveal_style", event.target.value)}><option value="none">None</option><option value="fade_up">Fade up</option><option value="slide_up">Slide up</option><option value="slide_side">Slide from side</option><option value="scale">Scale in</option><option value="mixed">Mixed by section</option><option value="custom">Custom</option></select></label>
                <label><span>Page transitions</span><select className="auth-input" value={intake.page_transition_style} disabled={isLocked} onChange={(event) => updateField("page_transition_style", event.target.value)}><option value="none">None</option><option value="fade">Fade</option><option value="slide">Slide</option><option value="morph">Morph</option><option value="custom">Custom</option></select></label>
                <label><span>Product-card hover</span><select className="auth-input" value={intake.product_card_hover_style} disabled={isLocked} onChange={(event) => updateField("product_card_hover_style", event.target.value)}><option value="none">None</option><option value="lift">Lift</option><option value="image_swap">Image swap</option><option value="zoom">Image zoom</option><option value="glow">Glow / highlight</option><option value="custom">Custom</option></select></label>
              </div>
              <div className="setup-form-grid">
                <label className="settings-card"><span>Parallax sections</span><input type="checkbox" checked={intake.parallax_enabled} disabled={isLocked} onChange={(event) => updateField("parallax_enabled", event.target.checked)} /></label>
                <label className="settings-card"><span>Sticky or pinned sections</span><input type="checkbox" checked={intake.sticky_sections_enabled} disabled={isLocked} onChange={(event) => updateField("sticky_sections_enabled", event.target.checked)} /></label>
                <label className="settings-card"><span>Horizontal-scroll sections</span><input type="checkbox" checked={intake.horizontal_scroll_enabled} disabled={isLocked} onChange={(event) => updateField("horizontal_scroll_enabled", event.target.checked)} /></label>
                <label className="settings-card"><span>Reduce motion on mobile</span><input type="checkbox" checked={intake.reduce_motion_mobile} disabled={isLocked} onChange={(event) => updateField("reduce_motion_mobile", event.target.checked)} /></label>
              </div>
              <label className="auth-label"><span>Storefront style direction</span><textarea className="auth-input" rows={3} value={intake.storefront_style} disabled={isLocked} onChange={(event) => updateField("storefront_style", event.target.value)} placeholder="Colors, fonts, spacing, mood, product-card style, homepage priorities, mobile direction." /></label>
              <label className="auth-label"><span>Animation and scrolling notes</span><textarea className="auth-input" rows={3} value={intake.animation_notes} disabled={isLocked} onChange={(event) => updateField("animation_notes", event.target.value)} placeholder="Example: Keep the hero pinned while featured products rise into view, then fade categories in softly." /></label>
              <label className="auth-label"><span>Inspiration URLs</span><textarea className="auth-input" rows={3} value={intake.inspiration_urls} disabled={isLocked} onChange={(event) => updateField("inspiration_urls", event.target.value)} placeholder="Add one website per line and say what you like or dislike about it." /></label>
            </section>

            <section className="panel panel-wide">
              <div className="panel-title"><ShoppingBag size={20} /><div><h2>Fulfillment and checkout</h2><p className="subtle">Define how customers receive orders and how checkout should behave.</p></div></div>
              <div className="setup-form-grid">{fulfillmentOptions.map(([value, label]) => <label className="settings-card" key={value}><span>{label}</span><input type="checkbox" checked={intake.fulfillment_methods.includes(value)} disabled={isLocked} onChange={() => toggleFulfillment(value)} /></label>)}</div>
              <div className="setup-form-grid"><label><span>Customer accounts</span><select className="auth-input" value={intake.customer_accounts_preference} disabled={isLocked} onChange={(event) => updateField("customer_accounts_preference", event.target.value)}><option value="disabled">Disabled</option><option value="optional">Optional</option><option value="required">Required</option><option value="not_sure">Not sure yet</option></select></label><label className="settings-card"><span>Allow guest checkout</span><input type="checkbox" checked={intake.guest_checkout_preference} disabled={isLocked} onChange={(event) => updateField("guest_checkout_preference", event.target.checked)} /></label></div>
              <label className="auth-label"><span>Shipping regions and rules</span><textarea className="auth-input" rows={3} value={intake.shipping_regions} disabled={isLocked} onChange={(event) => updateField("shipping_regions", event.target.value)} /></label>
              <label className="auth-label"><span>Local pickup or delivery details</span><textarea className="auth-input" rows={3} value={intake.local_pickup_details} disabled={isLocked} onChange={(event) => updateField("local_pickup_details", event.target.value)} /></label>
              <label className="auth-label"><span>Tax requirements</span><textarea className="auth-input" rows={3} value={intake.tax_requirements} disabled={isLocked} onChange={(event) => updateField("tax_requirements", event.target.value)} placeholder="Describe what you know. NXQ does not provide tax advice." /></label>
              <label className="auth-label"><span>Payment and checkout requirements</span><textarea className="auth-input" rows={3} value={intake.payment_requirements} disabled={isLocked} onChange={(event) => updateField("payment_requirements", event.target.value)} /></label>
              <label className="auth-label"><span>Preferred payment provider</span><input className="auth-input" value={intake.requested_payment_provider} disabled={isLocked} onChange={(event) => updateField("requested_payment_provider", event.target.value)} placeholder="Example: Stripe, Square, not sure" /></label>
            </section>

            <section className="panel panel-wide">
              <div className="panel-title"><ShoppingBag size={20} /><div><h2>Policies, content, and launch</h2><p className="subtle">Give NXQ the remaining information needed to plan the storefront.</p></div></div>
              <label className="auth-label"><span>Returns policy</span><textarea className="auth-input" rows={3} value={intake.returns_policy} disabled={isLocked} onChange={(event) => updateField("returns_policy", event.target.value)} /></label>
              <label className="auth-label"><span>Refund policy</span><textarea className="auth-input" rows={3} value={intake.refund_policy} disabled={isLocked} onChange={(event) => updateField("refund_policy", event.target.value)} /></label>
              <label className="auth-label"><span>Required integrations</span><textarea className="auth-input" rows={3} value={intake.integrations} disabled={isLocked} onChange={(event) => updateField("integrations", event.target.value)} /></label>
              <label className="auth-label"><span>Brand assets and product photography</span><textarea className="auth-input" rows={3} value={intake.brand_assets_notes} disabled={isLocked} onChange={(event) => updateField("brand_assets_notes", event.target.value)} /></label>
              <label className="auth-label"><span>Required pages</span><textarea className="auth-input" rows={3} value={intake.required_pages} disabled={isLocked} onChange={(event) => updateField("required_pages", event.target.value)} placeholder="Shop, categories, about, FAQ, policies, contact, etc." /></label>
              <label className="auth-label"><span>Special features</span><textarea className="auth-input" rows={3} value={intake.special_features} disabled={isLocked} onChange={(event) => updateField("special_features", event.target.value)} /></label>
              <label className="auth-label"><span>Launch priority or target date</span><input className="auth-input" value={intake.launch_priority} disabled={isLocked} onChange={(event) => updateField("launch_priority", event.target.value)} /></label>
              <label className="auth-label"><span>Anything else NXQ should know?</span><textarea className="auth-input" rows={4} value={intake.additional_notes} disabled={isLocked} onChange={(event) => updateField("additional_notes", event.target.value)} /></label>
            </section>

            <section className="panel panel-wide">
              <div className="panel-title"><CheckCircle2 size={20} /><div><h2>Save or submit</h2><p className="subtle">Save a draft anytime. Submit when the information is ready for NXQ review.</p></div></div>
              <div className="setup-form-grid"><button className="icon-btn" type="button" disabled={saving || isLocked} onClick={() => void saveIntake(false)}><Save size={16} />{saving ? "Saving..." : "Save draft"}</button><button className="wide-btn" type="button" disabled={saving || isLocked} onClick={() => void saveIntake(true)}><CheckCircle2 size={16} />{saving ? "Submitting..." : "Submit for NXQ review"}</button></div>
              {intake.status ? <p className="subtle">Current intake status: {intake.status.replaceAll("_", " ")}</p> : null}
            </section>
          </div>
        ) : null}
      </section>
    </main>
  );
}
