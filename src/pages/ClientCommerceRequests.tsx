import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, MessageSquareText, RefreshCw, Save, Settings2, TestTube2 } from "lucide-react";
import { CommerceNav } from "../components/CommerceNav";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    void loadPage();
  }, []);

  async function loadPage() {
    setLoading(true);
    setError("");
    if (!isSupabaseConfigured || !supabase) {
      setError("Commerce requests are unavailable because Supabase is not configured.");
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

    if (settingsResult.error) setError(`Request settings failed to load: ${settingsResult.error.message}`);
    else if (settingsResult.data) setSettings({ ...initialSettings, ...(settingsResult.data as RequestSettings) });

    if (requestsResult.error) setError(`Customer requests failed to load: ${requestsResult.error.message}`);
    else setRequests((requestsResult.data || []) as CustomerRequest[]);

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
    if (!supabase) return;
    setSaving(true);
    setError("");
    setMessage("");
    const result = await supabase.rpc("save_my_commerce_request_settings", { settings_payload: settings });
    setSaving(false);
    if (result.error) {
      setError(`Request settings could not be saved: ${result.error.message}`);
      return;
    }
    setSettings({ ...initialSettings, ...(result.data as RequestSettings) });
    setSettingsOpen(false);
    setMessage("Customer request settings saved.");
  }

  async function createTestRequest() {
    if (!supabase) return;
    setError("");
    setMessage("");
    const result = await supabase.rpc("create_protected_test_commerce_request");
    if (result.error) {
      setError(`Protected test request could not be created: ${result.error.message}`);
      return;
    }
    setMessage("Protected test request created. No customer was contacted and no order was created.");
    await loadPage();
  }

  async function updateRequest(request: CustomerRequest, status: string, note: string) {
    if (!supabase) return;
    setError("");
    setMessage("");
    const result = await supabase.rpc("update_my_commerce_customer_request", {
      request_id: request.id,
      new_status: status,
      new_note: note,
    });
    if (result.error) {
      setError(`Request could not be updated: ${result.error.message}`);
      return;
    }
    setMessage("Customer request updated.");
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
          <button className="icon-btn" type="button" onClick={() => void loadPage()}><RefreshCw size={16} /> Refresh</button>
        </div>

        {error ? <div className="auth-error">{error}</div> : null}
        {message ? <div className="auth-success">{message}</div> : null}
        {loading ? <div className="empty-state">Loading customer requests...</div> : null}

        {!loading ? (
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
                <button className="icon-btn" type="button" onClick={() => setSettingsOpen((current) => !current)}>
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
                    <label className="settings-card"><span>Enable customer requests</span><input type="checkbox" checked={settings.enabled} onChange={(event) => setSettings((current) => ({ ...current, enabled: event.target.checked }))} /></label>
                    <label className="settings-card"><span>Allow guest requests</span><input type="checkbox" checked={settings.allow_guest_requests} onChange={(event) => setSettings((current) => ({ ...current, allow_guest_requests: event.target.checked }))} /></label>
                    <label className="settings-card"><span>Allow reference images</span><input type="checkbox" checked={settings.allow_image_uploads} onChange={(event) => setSettings((current) => ({ ...current, allow_image_uploads: event.target.checked }))} /></label>
                    <label className="settings-card"><span>Require a budget</span><input type="checkbox" checked={settings.require_budget} onChange={(event) => setSettings((current) => ({ ...current, require_budget: event.target.checked }))} /></label>
                    <label className="settings-card"><span>Require needed-by date</span><input type="checkbox" checked={settings.require_needed_by_date} onChange={(event) => setSettings((current) => ({ ...current, require_needed_by_date: event.target.checked }))} /></label>
                    <label><span>Notification email</span><input className="auth-input" value={settings.notification_email} onChange={(event) => setSettings((current) => ({ ...current, notification_email: event.target.value }))} placeholder="orders@example.com" /></label>
                    <label><span>Maximum images per request</span><input className="auth-input" type="number" min={0} max={10} value={settings.max_images_per_request} onChange={(event) => setSettings((current) => ({ ...current, max_images_per_request: Number(event.target.value) }))} /></label>
                    <label><span>Maximum image size in MB</span><input className="auth-input" type="number" min={1} max={20} value={settings.max_image_size_mb} onChange={(event) => setSettings((current) => ({ ...current, max_image_size_mb: Number(event.target.value) }))} /></label>
                  </div>

                  <h3>Allowed request types</h3>
                  <div className="setup-form-grid">
                    {requestTypeOptions.map(([value, label]) => <label className="settings-card" key={value}><span>{label}</span><input type="checkbox" checked={settings.allowed_request_types.includes(value)} onChange={() => toggleRequestType(value)} /></label>)}
                  </div>

                  <label className="auth-label"><span>Estimated response time</span><input className="auth-input" value={settings.response_time_text} onChange={(event) => setSettings((current) => ({ ...current, response_time_text: event.target.value }))} /></label>
                  <label className="auth-label"><span>Customer instructions</span><textarea className="auth-input" rows={3} value={settings.custom_instructions} onChange={(event) => setSettings((current) => ({ ...current, custom_instructions: event.target.value }))} placeholder="Explain what details customers should include." /></label>
                  <label className="auth-label"><span>Confirmation message</span><textarea className="auth-input" rows={3} value={settings.confirmation_message} onChange={(event) => setSettings((current) => ({ ...current, confirmation_message: event.target.value }))} /></label>
                  <button className="wide-btn" type="button" disabled={saving} onClick={() => void saveSettings()}><Save size={16} /> {saving ? "Saving..." : "Save request settings"}</button>
                </div>
              ) : null}
            </section>

            <section className="panel panel-wide">
              <div className="panel-title"><MessageSquareText size={20} /><div><h2>Submitted requests</h2><p className="subtle">These are managed by the store owner, not approved by NXQ.</p></div></div>
              {requests.length === 0 ? <div className="empty-state">No customer requests yet.</div> : null}
              {requests.map((request) => <RequestCard key={request.id} request={request} onSave={updateRequest} />)}
            </section>

            <details className="panel panel-wide">
              <summary style={{ cursor: "pointer", fontWeight: 700 }}>Testing tools</summary>
              <div className="panel-title" style={{ marginTop: "1rem" }}><TestTube2 size={20} /><div><h2>Protected workflow test</h2><p className="subtle">Creates a private test request only. It does not contact anyone, create an order, charge money, or publish a storefront.</p></div></div>
              <button className="icon-btn" type="button" onClick={() => void createTestRequest()}><TestTube2 size={16} /> Create protected test request</button>
            </details>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function RequestCard({ request, onSave }: { request: CustomerRequest; onSave: (request: CustomerRequest, status: string, note: string) => Promise<void> }) {
  const [status, setStatus] = useState(request.status);
  const [note, setNote] = useState(request.client_note || "");
  const requestType = requestTypeOptions.find(([value]) => value === request.request_type)?.[1] || request.request_type.replaceAll("_", " ");

  return (
    <article className="settings-card" style={{ marginTop: "1rem" }}>
      <div className="panel-title-row">
        <div><h3>{request.product_name}</h3><p className="subtle">{requestType} · {request.customer_name} · {request.customer_email}</p></div>
        <strong>{request.status.replaceAll("_", " ")}</strong>
      </div>
      <p>{request.description}</p>
      <div className="setup-form-grid">
        <div><strong>Quantity</strong><p>{request.desired_quantity || "Not provided"}</p></div>
        <div><strong>Budget</strong><p>{request.budget_range || "Not provided"}</p></div>
        <div><strong>Needed by</strong><p>{request.needed_by_date || "Not provided"}</p></div>
        <div><strong>Preferred contact</strong><p>{request.preferred_contact_method}</p></div>
      </div>
      {request.reference_images?.length ? (
        <div className="empty-state">
          <strong>Private reference images</strong>
          {request.reference_images.map((file) => (
            <p className="subtle" key={file.client_file_id}>
              {file.file_name} · {file.scan_status === "clean" && file.quarantine_status === "released" ? "security scan passed" : "restricted pending security approval"}
            </p>
          ))}
        </div>
      ) : null}
      <div className="setup-form-grid">
        <label><span>Status</span><select className="auth-input" value={status} onChange={(event) => setStatus(event.target.value)}>{statusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label><span>Store note</span><input className="auth-input" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Internal note or response summary" /></label>
      </div>
      <button className="wide-btn" type="button" onClick={() => void onSave(request, status, note)}><Save size={16} /> Save request update</button>
    </article>
  );
}
