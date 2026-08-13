import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { ArrowLeft, CheckCircle2, MessageSquareText, Send } from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

type PublicRequestSettings = {
  allow_guest_requests: boolean;
  allow_image_uploads: boolean;
  require_budget: boolean;
  require_needed_by_date: boolean;
  max_images_per_request: number;
  max_image_size_mb: number;
  response_time_text: string;
  custom_instructions: string;
  confirmation_message: string;
  allowed_request_types: string[];
};

type FormDataResult = {
  storefront: { store_name: string; store_slug: string };
  settings: PublicRequestSettings;
};

const requestTypeOptions = [
  ["custom_product", "Custom product"],
  ["new_option", "New scent, color, size, or style"],
  ["restock", "Restock request"],
  ["bulk_order", "Bulk or wholesale order"],
  ["personalized", "Personalized product"],
  ["general_suggestion", "General product suggestion"],
] as const;

export function PublicCommerceRequest() {
  const storeSlug = useMemo(() => new URLSearchParams(window.location.search).get("store")?.trim().toLowerCase() || "", []);
  const [formData, setFormData] = useState<FormDataResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [requestType, setRequestType] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [preferredContact, setPreferredContact] = useState("email");
  const [productName, setProductName] = useState("");
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("");
  const [budget, setBudget] = useState("");
  const [neededBy, setNeededBy] = useState("");
  const [referenceLinks, setReferenceLinks] = useState("");
  const [companyWebsite, setCompanyWebsite] = useState("");

  useEffect(() => {
    void loadForm();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- initial request-form bootstrap only

  async function loadForm() {
    setLoading(true);
    setError("");
    if (!storeSlug) {
      setError("This customer request link is missing its storefront name.");
      setLoading(false);
      return;
    }
    if (!isSupabaseConfigured || !supabase) {
      setError("Customer requests are unavailable right now.");
      setLoading(false);
      return;
    }

    const result = await supabase.rpc("get_public_commerce_request_form", { store_slug_input: storeSlug });
    if (result.error) {
      setError(result.error.message);
      setLoading(false);
      return;
    }

    const loaded = result.data as FormDataResult;
    setFormData(loaded);
    setRequestType(loaded.settings.allowed_request_types[0] || "");
    setLoading(false);
  }

  async function submitRequest(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !formData) return;
    setSubmitting(true);
    setError("");
    setSuccess("");

    const referenceUrls = referenceLinks
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean);

    const result = await supabase.rpc("submit_public_commerce_customer_request", {
      store_slug_input: storeSlug,
      request_payload: {
        request_type: requestType,
        customer_name: customerName,
        customer_email: customerEmail,
        preferred_contact_method: preferredContact,
        product_name: productName,
        description,
        desired_quantity: quantity,
        budget_range: budget,
        needed_by_date: neededBy,
        reference_urls: referenceUrls,
        company_website: companyWebsite,
      },
    });

    setSubmitting(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }

    const response = result.data as { confirmation_message?: string; response_time_text?: string };
    setSuccess(`${response.confirmation_message || "Your request was sent successfully."} ${response.response_time_text || ""}`.trim());
    setProductName("");
    setDescription("");
    setQuantity("");
    setBudget("");
    setNeededBy("");
    setReferenceLinks("");
  }

  const availableTypes = requestTypeOptions.filter(([value]) => formData?.settings.allowed_request_types.includes(value));

  return (
    <main className="nxq-page">
      <section className="portal-shell">
        <a className="icon-btn" href="/" style={{ width: "fit-content" }}><ArrowLeft size={16} /> Back to store</a>
        <div className="panel-title">
          <MessageSquareText size={24} />
          <div>
            <h1>{formData?.storefront.store_name || "Customer request"}</h1>
            <p className="subtle">Request a custom product, restock, bulk order, or new option from this store.</p>
          </div>
        </div>

        {loading ? <div className="empty-state">Loading request form...</div> : null}
        {error ? <div className="auth-error">{error}</div> : null}
        {success ? <div className="auth-success"><CheckCircle2 size={18} /> {success}</div> : null}

        {!loading && formData ? (
          <form className="panel" onSubmit={(event) => void submitRequest(event)}>
            {formData.settings.custom_instructions ? <div className="empty-state">{formData.settings.custom_instructions}</div> : null}

            <div className="setup-form-grid">
              <label><span>Request type</span><select className="auth-input" value={requestType} onChange={(event) => setRequestType(event.target.value)} required>{availableTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label><span>Your name</span><input className="auth-input" value={customerName} onChange={(event) => setCustomerName(event.target.value)} maxLength={120} required /></label>
              <label><span>Email</span><input className="auth-input" type="email" value={customerEmail} onChange={(event) => setCustomerEmail(event.target.value)} maxLength={200} required /></label>
              <label><span>Preferred contact</span><select className="auth-input" value={preferredContact} onChange={(event) => setPreferredContact(event.target.value)}><option value="email">Email</option><option value="phone">Phone</option><option value="text">Text message</option></select></label>
              <label><span>Request title</span><input className="auth-input" value={productName} onChange={(event) => setProductName(event.target.value)} placeholder="Example: Custom cedarwood candle" maxLength={160} required /></label>
              <label><span>Quantity</span><input className="auth-input" type="number" min={1} max={100000} value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label>
              <label><span>Budget {formData.settings.require_budget ? "(required)" : "(optional)"}</span><input className="auth-input" value={budget} onChange={(event) => setBudget(event.target.value)} placeholder="Example: $50-$100" required={formData.settings.require_budget} /></label>
              <label><span>Needed by {formData.settings.require_needed_by_date ? "(required)" : "(optional)"}</span><input className="auth-input" type="date" value={neededBy} onChange={(event) => setNeededBy(event.target.value)} required={formData.settings.require_needed_by_date} /></label>
            </div>

            <label className="auth-label"><span>Request details</span><textarea className="auth-input" rows={7} value={description} onChange={(event) => setDescription(event.target.value)} minLength={10} maxLength={5000} placeholder="Describe the product, size, color, style, customization, or restock you need." required /></label>

            {formData.settings.allow_image_uploads && formData.settings.max_images_per_request > 0 ? (
              <label className="auth-label"><span>Reference image links (optional)</span><textarea className="auth-input" rows={3} value={referenceLinks} onChange={(event) => setReferenceLinks(event.target.value)} placeholder={`Paste one image link per line, up to ${formData.settings.max_images_per_request}.`} /><small className="subtle">Direct file uploads will be connected in the protected media phase. For now, customers can paste reference links.</small></label>
            ) : null}

            <input aria-hidden="true" autoComplete="off" tabIndex={-1} value={companyWebsite} onChange={(event) => setCompanyWebsite(event.target.value)} style={{ position: "absolute", left: "-10000px" }} />
            <button className="wide-btn" type="submit" disabled={submitting || !requestType}><Send size={17} /> {submitting ? "Sending..." : "Send request"}</button>
            <p className="subtle" style={{ textAlign: "center" }}>{formData.settings.response_time_text}</p>
          </form>
        ) : null}
      </section>
    </main>
  );
}
