import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Mail, MessageSquareText, RefreshCw, Save, Settings2, TestTube2 } from "lucide-react";
import { CommerceNav } from "../components/CommerceNav";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";
import { mailtoHref, requestReplyDraft, splitInspirationLink } from "../lib/commerceRequestExtras";

type RequestSettings = {
  enabled: boolean;
  allow_guest_requests: boolean;
  allow_image_uploads: boolean;
  require_budget: boolean;
  require_needed_by_date: boolean;
  max_images_per_request: number;
  max_image_size_mb: number;
  response_time_text: string;
  custom_instructions: string;
  confirmation_message: string;
  notification_email: string;
  allowed_request_types: string[];
};

type CustomerRequest = {
  id: string;
  request_type: string;
  customer_name: string;
  customer_email: string;
  preferred_contact_method: string;
  product_name: string;
  description: string;
  desired_quantity?: number | null;
  budget_range?: string | null;
  needed_by_date?: string | null;
  status: string;
  client_note: string;
  created_at: string;
  reference_images?: Array<{
    client_file_id: string;
    file_name: string;
    scan_status: string;
    quarantine_status: string;
  }>;
};

const requestTypeOptions = [
  ["custom_product", "Custom product"],
  ["new_option", "New scent, color, size, or style"],
  ["restock", "Restock request"],
  ["bulk_order", "Bulk or wholesale order"],
  ["personalized", "Personalized product"],
  ["general_suggestion", "General product suggestion"],
] as const;

const statusOptions = [
  ["new", "New"],
  ["reviewing", "Reviewing"],
  ["need_more_information", "Need more information"],
  ["accepted", "Accepted"],
  ["declined", "Declined"],
  ["quoted", "Quoted"],
  ["in_progress", "In progress"],
  ["completed", "Completed"],
] as const;

const initialSettings: RequestSettings = {
  enabled: false,
  allow_guest_requests: true,
  allow_image_uploads: true,
  require_budget: false,
  require_needed_by_date: false,
  max_images_per_request: 3,
  max_image_size_mb: 8,
  response_time_text: "We usually respond within 2 business days.",
  custom_instructions: "",
  confirmation_message: "Your request was sent successfully. We will review it and contact you soon.",
  notification_email: "",
  allowed_request_types: requestTypeOptions.map(([value]) => value),
};

export function ClientCommerceRequests() {
  const [settings, setSettings] = useState<RequestSettings>(initialSettings);
  const [requests, setRequests] = useState<CustomerRequest[]>([]);
  const [storeName, setStoreName] = useState("");
  const [loading, setLoading] = useState(true);
  const [verified, setVerified] = useState(false);
  const [saving, setSaving] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    // The shop name for reply drafts comes from the signup business name (no extra data is read); a missing one falls back to "our shop" inside the draft.
    if (supabase) void supabase.auth.getUser().then((result) => { const name = result.data?.user?.user_metadata?.business_name; if (typeof name === "string") setStoreName(name.trim().slice(0, 80)); }).catch(() => undefined);
    void loadPage();
  }, []);

  async function loadPage() {
    setLoading(true);
    setVerified(false);
    setError("");
    if (!isSupabaseConfigured || !supabase) {
      setRequests([]);
      setError("Commerce requests are temporarily unavailable. No request settings or customer requests were changed.");
      setLoading(false);
      return;
    }

    const session = await supabase.auth.getSession();
    if (!session.data.session) {
      window.location.replace("/portal/login");
      return;
    }

    const [settingsResult, requestsResult] = await Promise.all([
      supabase.rpc("get_my_commerce_request_settings"),
      supabase.rpc("list_my_commerce_customer_requests"),
    ]);

    if (settingsResult.error || requestsResult.error) {
      setRequests([]);
      setError("Customer request data could not be verified right now. Please try again shortly.");
      setLoading(false);
      return;
    }

    setSettings(settingsResult.data ? { ...initialSettings, ...(settingsResult.data as RequestSettings) } : initialSettings);
    setRequests((requestsResult.data || []) as CustomerRequest[]);
    setVerified(true);
    setLoading(false);
  }

  function toggleRequestType(value: string) {
    setSettings((current) => ({
      ...current,
      allowed_request_types: current.allowed_request_types.includes(value)
        ? current.allowed_request_types.filter((item) => item !== value)
        : [...current.allowed_request_types, value],
    }));
  }

  async function saveSettings() {
    if (!supabase || saving) return;
    setSaving(true);
    setError("");
    setMessage("");
    const result = await supabase.rpc("save_my_commerce_request_settings", { settings_payload: settings });
    setSaving(false);
    if (result.error) {
      setError("Request settings could not be saved. The previous verified settings remain in effect.");
      return;
    }
    setSettings({ ...initialSettings, ...(result.data as RequestSettings) });
    setSettingsOpen(false);
    setMessage("Customer request settings saved. This does not create an order, charge a customer, or publish a storefront.");
  }

  async function createTestRequest() {
    if (!supabase || saving) return;
    setSaving(true);
    setError("");
    setMessage("");
    const result = await supabase.rpc("create_protected_test_commerce_request");
    setSaving(false);
    if (result.error) {
      setError("The protected test request could not be created. No customer was contacted and no order was created.");
      return;
    }
    setMessage("Protected test request created. No customer was contacted and no order was created.");
    await loadPage();
  }

  async function updateRequest(request: CustomerRequest, status: string, note: string) {
    if (!supabase || saving) return;
    setSaving(true);
    setError("");
    setMessage("");
    const result = await supabase.rpc("update_my_commerce_customer_request", {
      request_id: request.id,
      new_status: status,
      new_note: note,
    });
    setSaving(false);
    if (result.error) {
      setError("Customer request could not be updated. Its previous status and note were left unchanged.");
      return;
    }
    setMessage("Customer request updated. This did not create an order or trigger payment.");
    await loadPage();
  }

  const enabledTypeLabels = requestTypeOptions
    .filter(([value]) => settings.allowed_request_types.includes(value))
    .map(([, label]) => label);

  return (
    <main className="nxq-page">
      <section className="portal-shell">
        <CommerceNav />
        <div className="panel-title panel-title-row">
          <div className="panel-title"><MessageSquareText size={22} /><div><h1>Customer requests</h1><p className="subtle">Let customers request custom products, restocks, bulk orders, or new options without turning the request into an order.</p></div></div>
          <button className="icon-btn" disabled={loading || saving} type="button" onClick={() => void loadPage()}><RefreshCw size={16} /> Refresh</button>
        </div>

        {error ? <div className="auth-error">{error}</div> : null}
        {message ? <div className="auth-success">{message}</div> : null}
        {loading ? <div className="empty-state">Loading customer requests...</div> : null}

        {!loading && verified ? (
          <div className="owner-detail-grid">
            <section className="panel panel-wide">
              <div className="panel-title-row">
                <div className="panel-title">
                  <Settings2 size={20} />
                  <div>
                    <h2>Customer request settings</h2>
                    <p className="subtle">
                      {settings.enabled ? "Enabled" : "Disabled"}
                      {settings.enabled && settings.allow_guest_requests ? " · Guest requests allowed" : ""}
                      {settings.enabled ? ` · ${enabledTypeLabels.length} request type${enabledTypeLabels.length === 1 ? "" : "s"}` : ""}
                    </p>
                  </div>
                </div>
                <button className="icon-btn" disabled={saving} type="button" onClick={() => setSettingsOpen((current) => !current)}>
                  {settingsOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  {settingsOpen ? "Close settings" : "Edit settings"}
                </button>
              </div>

              {!settingsOpen ? (
                <div className="empty-state">
                  {settings.enabled
                    ? `${enabledTypeLabels.join(", ") || "No request types selected"}. Up to ${settings.max_images_per_request} image${settings.max_images_per_request === 1 ? "" : "s"} per request at ${settings.max_image_size_mb} MB each.`
                    : "Customer requests are currently turned off for this storefront."}
                </div>
              ) : null}

              {settingsOpen ? (
                <div style={{ marginTop: "1rem" }}>
                  <div className="setup-form-grid">
                    <label className="settings-card"><span>Enable customer requests</span><input disabled={saving} type="checkbox" checked={settings.enabled} onChange={(event) => setSettings((current) => ({ ...current, enabled: event.target.checked }))} /></label>
                    <label className="settings-card"><span>Allow guest requests</span><input disabled={saving} type="checkbox" checked={settings.allow_guest_requests} onChange={(event) => setSettings((current) => ({ ...current, allow_guest_requests: event.target.checked }))} /></label>
                    <label className="settings-card"><span>Allow reference images</span><input disabled={saving} type="checkbox" checked={settings.allow_image_uploads} onChange={(event) => setSettings((current) => ({ ...current, allow_image_uploads: event.target.checked }))} /></label>
                    <label className="settings-card"><span>Require a budget</span><input disabled={saving} type="checkbox" checked={settings.require_budget} onChange={(event) => setSettings((current) => ({ ...current, require_budget: event.target.checked }))} /></label>
                    <label className="settings-card"><span>Require needed-by date</span><input disabled={saving} type="checkbox" checked={settings.require_needed_by_date} onChange={(event) => setSettings((current) => ({ ...current, require_needed_by_date: event.target.checked }))} /></label>
                    <label><span>Notification email</span><input className="auth-input" disabled={saving} value={settings.notification_email} onChange={(event) => setSettings((current) => ({ ...current, notification_email: event.target.value }))} placeholder="orders@example.com" /></label>
                    <label><span>Maximum images per request</span><input className="auth-input" disabled={saving} type="number" min={0} max={10} value={settings.max_images_per_request} onChange={(event) => setSettings((current) => ({ ...current, max_images_per_request: Number(event.target.value) }))} /></label>
                    <label><span>Maximum image size in MB</span><input className="auth-input" disabled={saving} type="number" min={1} max={20} value={settings.max_image_size_mb} onChange={(event) => setSettings((current) => ({ ...current, max_image_size_mb: Number(event.target.value) }))} /></label>
                  </div>

                  <h3>Allowed request types</h3>
                  <div className="setup-form-grid">
                    {requestTypeOptions.map(([value, label]) => <label className="settings-card" key={value}><span>{label}</span><input disabled={saving} type="checkbox" checked={settings.allowed_request_types.includes(value)} onChange={() => toggleRequestType(value)} /></label>)}
                  </div>

                  <label className="auth-label"><span>Estimated response time</span><input className="auth-input" disabled={saving} value={settings.response_time_text} onChange={(event) => setSettings((current) => ({ ...current, response_time_text: event.target.value }))} /></label>
                  <label className="auth-label"><span>Customer instructions</span><textarea className="auth-input" disabled={saving} rows={3} value={settings.custom_instructions} onChange={(event) => setSettings((current) => ({ ...current, custom_instructions: event.target.value }))} placeholder="Explain what details customers should include." /></label>
                  <label className="auth-label"><span>Confirmation message</span><textarea className="auth-input" disabled={saving} rows={3} value={settings.confirmation_message} onChange={(event) => setSettings((current) => ({ ...current, confirmation_message: event.target.value }))} /></label>
                  <button className="wide-btn" type="button" disabled={saving} onClick={() => void saveSettings()}><Save size={16} /> {saving ? "Saving..." : "Save request settings"}</button>
                </div>
              ) : null}
            </section>

            <section className="panel panel-wide">
              <div className="panel-title"><MessageSquareText size={20} /><div><h2>Submitted requests</h2><p className="subtle">These are managed by the store owner, not approved by NXQX. A request is not an order and does not authorize payment.</p></div></div>
              {requests.length === 0 ? <div className="empty-state">No verified customer requests yet.</div> : null}
              {requests.map((request) => <RequestCard key={request.id} request={request} disabled={saving} onSave={updateRequest} storeName={storeName} />)}
            </section>

            <details className="panel panel-wide">
              <summary style={{ cursor: "pointer", fontWeight: 700 }}>Testing tools</summary>
              <div className="panel-title" style={{ marginTop: "1rem" }}><TestTube2 size={20} /><div><h2>Protected workflow test</h2><p className="subtle">Creates a private test request only. It does not contact anyone, create an order, charge money, activate a provider, or publish a storefront.</p></div></div>
              <button className="icon-btn" disabled={saving} type="button" onClick={() => void createTestRequest()}><TestTube2 size={16} /> Create protected test request</button>
            </details>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function RequestCard({ request, onSave, disabled, storeName }: { request: CustomerRequest; onSave: (request: CustomerRequest, status: string, note: string) => Promise<void>; disabled: boolean; storeName: string }) {
  const [status, setStatus] = useState(request.status);
  const [note, setNote] = useState(request.client_note || "");
  const requestType = requestTypeOptions.find(([value]) => value === request.request_type)?.[1] || request.request_type.replaceAll("_", " ");
  const details = splitInspirationLink(request.description);
  const [viewing, setViewing] = useState<string | null>(null);
  const [pictureError, setPictureError] = useState("");
  // A held picture is never opened (same rule as the Files page); a cleared one opens through the protected link in a new tab.
  async function viewPicture(clientFileId: string) {
    if (!supabase || viewing) return;
    setViewing(clientFileId); setPictureError("");
    const result = await supabase.functions.invoke("secure-client-file-access", { body: { client_file_id: clientFileId, download: false } });
    const data = result.data as { ok?: boolean; signed_url?: string } | null;
    setViewing(null);
    if (result.error || !data?.ok || !data.signed_url) { setPictureError("A secure picture link could not be prepared right now. The picture stays private and unchanged."); return; }
    window.open(data.signed_url, "_blank", "noopener,noreferrer");
  }
  const reply = requestReplyDraft({ status, customerName: request.customer_name, productName: request.product_name, storeName, note });
  const replyHref = mailtoHref(request.customer_email, reply.subject, reply.body);

  return (
    <article className="settings-card" style={{ marginTop: "1rem" }}>
      <div className="panel-title-row">
        <div><h3>{request.product_name}</h3><p className="subtle">{requestType} · {request.customer_name} · {request.customer_email}</p></div>
        <strong>{request.status.replaceAll("_", " ")}</strong>
      </div>
      <p style={{ whiteSpace: "pre-wrap" }}>{details.text}</p>
      {details.url ? <p><strong>Photo link from the customer:</strong>{" "}<a href={details.url} target="_blank" rel="noopener noreferrer nofollow">{details.url}</a><br /><small className="subtle">This opens another website. Only open links you trust.</small></p> : null}
      <div className="setup-form-grid">
        <div><strong>Quantity</strong><p>{request.desired_quantity ?? "Not provided"}</p></div>
        <div><strong>Budget</strong><p>{request.budget_range || "Not provided"}</p></div>
        <div><strong>Needed by</strong><p>{request.needed_by_date || "Not provided"}</p></div>
        <div><strong>Preferred contact</strong><p>{request.preferred_contact_method || "Not provided"}</p></div>
      </div>
      {request.reference_images?.length ? (
        <div className="empty-state">
          <strong>Private reference images</strong>
          {request.reference_images.map((file) => (
            <p className="subtle" key={file.client_file_id}>
              {file.file_name} · {file.scan_status === "clean" && file.quarantine_status === "released" ? "security scan passed" : "restricted pending security approval"}
              {file.scan_status === "clean" && file.quarantine_status === "released" ? <>{" "}<button className="icon-btn" type="button" disabled={viewing === file.client_file_id} onClick={() => void viewPicture(file.client_file_id)}>{viewing === file.client_file_id ? "Opening..." : "View picture"}</button></> : null}
            </p>
          ))}
        </div>
      ) : null}
      <div className="setup-form-grid">
        <label><span>Status</span><select className="auth-input" disabled={disabled} value={status} onChange={(event) => setStatus(event.target.value)}>{statusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label><span>Store note</span><input className="auth-input" disabled={disabled} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Internal note or response summary" /></label>
      </div>
      <button className="wide-btn" disabled={disabled} type="button" onClick={() => void onSave(request, status, note)}><Save size={16} /> Save request update</button>
      {pictureError ? <div className="auth-error" role="alert">{pictureError}</div> : null}
      {replyHref ? <p><a className="icon-btn" href={replyHref} data-testid="email-customer"><Mail size={16} /> Email {request.customer_name.split(" ")[0] || "customer"} (opens your email app with a draft to edit)</a></p> : <p className="subtle">No usable email address on this request, so use the preferred contact: {request.preferred_contact_method || "not provided"}.</p>}
    </article>
  );
}
