import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  RefreshCcw,
  Rocket,
  SearchCheck,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

type ClientRow = { id: string; business_name: string };

type PreviewRow = {
  id: string;
  deployment_config_id: string;
  project_id: string;
  client_id: string;
  source_branch: string;
  preview_url: string | null;
  execution_status: string;
  execution_completed_at: string | null;
};

type ConfigRow = {
  id: string;
  project_id: string;
  client_id: string;
  production_branch: string;
  production_url: string | null;
};

type AuditIssue = { key: string; message: string };
type AuditCheck = {
  ok: boolean;
  severity: "critical" | "warning";
  message: string;
};

type LaunchRow = {
  id: string;
  deployment_config_id: string;
  project_id: string;
  client_id: string;
  preview_request_id: string;
  production_branch: string;
  production_url: string | null;
  status: string;
  audit_checked_at: string | null;
  audit_status: "not_checked" | "passed" | "blocked";
  audit_details: Record<string, AuditCheck> | null;
  critical_blockers: AuditIssue[];
  warnings: AuditIssue[];
  owner_decision_at: string | null;
  owner_decision_note: string | null;
  created_at: string;
};

type AuditResult = {
  passed: boolean;
  status: "audit_passed" | "audit_blocked";
  audit_status: "passed" | "blocked";
  checked_at: string;
  production: false;
  production_branch: string;
  production_url: string | null;
  preview_url: string | null;
  checks: Record<string, AuditCheck>;
  critical_blockers: AuditIssue[];
  warnings: AuditIssue[];
};

const launchSelect =
  "id, deployment_config_id, project_id, client_id, preview_request_id, production_branch, production_url, status, audit_checked_at, audit_status, audit_details, critical_blockers, warnings, owner_decision_at, owner_decision_note, created_at";

function formatStatus(value: string) {
  return value.replaceAll("_", " ");
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString([], { dateStyle: "short", timeStyle: "short" });
}

export function OwnerProductionLaunches() {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [previews, setPreviews] = useState<PreviewRow[]>([]);
  const [configs, setConfigs] = useState<ConfigRow[]>([]);
  const [launches, setLaunches] = useState<LaunchRow[]>([]);
  const [selectedPreviewId, setSelectedPreviewId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [auditingId, setAuditingId] = useState("");
  const [decidingId, setDecidingId] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [actionMessage, setActionMessage] = useState("");

  async function loadData() {
    setIsLoading(true);
    setErrorMessage("");

    if (!isSupabaseConfigured || !supabase) {
      setErrorMessage("Supabase is not configured yet.");
      setIsLoading(false);
      return;
    }

    const [clientResult, previewResult, configResult, launchResult] = await Promise.all([
      supabase.from("clients").select("id, business_name").order("business_name"),
      supabase
        .from("preview_deployment_requests")
        .select("id, deployment_config_id, project_id, client_id, source_branch, preview_url, execution_status, execution_completed_at")
        .eq("execution_status", "published")
        .order("execution_completed_at", { ascending: false }),
      supabase
        .from("project_deployment_configs")
        .select("id, project_id, client_id, production_branch, production_url"),
      supabase.from("production_launch_requests").select(launchSelect).order("created_at", { ascending: false }),
    ]);

    const firstError = clientResult.error || previewResult.error || configResult.error || launchResult.error;
    if (firstError) {
      setErrorMessage(firstError.message || "Unable to load production launch requests.");
      setIsLoading(false);
      return;
    }

    setClients((clientResult.data || []) as ClientRow[]);
    setPreviews((previewResult.data || []) as PreviewRow[]);
    setConfigs((configResult.data || []) as ConfigRow[]);
    setLaunches((launchResult.data || []) as LaunchRow[]);
    setIsLoading(false);
  }

  useEffect(() => {
    void loadData();
  }, []);

  const clientNameById = useMemo(
    () => new Map(clients.map((client) => [client.id, client.business_name])),
    [clients]
  );

  const activePreviewIds = useMemo(
    () => new Set(launches.filter((launch) => !["rejected", "cancelled", "failed"].includes(launch.status)).map((launch) => launch.preview_request_id)),
    [launches]
  );

  const availablePreviews = previews.filter((preview) => !activePreviewIds.has(preview.id));

  async function createLaunchRequest() {
    if (!supabase || !selectedPreviewId) return;
    const preview = previews.find((item) => item.id === selectedPreviewId);
    if (!preview?.preview_url || preview.execution_status !== "published") {
      setErrorMessage("Only a saved published preview can create a production launch request.");
      return;
    }

    const config = configs.find((item) => item.id === preview.deployment_config_id);
    if (!config) {
      setErrorMessage("The deployment configuration for this preview is missing.");
      return;
    }

    setCreating(true);
    setErrorMessage("");
    setActionMessage("");

    const result = await supabase
      .from("production_launch_requests")
      .insert({
        deployment_config_id: preview.deployment_config_id,
        project_id: preview.project_id,
        client_id: preview.client_id,
        preview_request_id: preview.id,
        production_branch: config.production_branch,
        production_url: config.production_url,
        status: "audit_required",
      })
      .select(launchSelect)
      .single();

    setCreating(false);
    if (result.error) {
      setErrorMessage(`Production launch request creation failed: ${result.error.message}`);
      return;
    }

    setLaunches((current) => [result.data as LaunchRow, ...current]);
    setSelectedPreviewId("");
    setActionMessage("Production launch request created. Nothing was deployed.");
  }

  async function runAudit(launch: LaunchRow) {
    if (!supabase) return;
    setAuditingId(launch.id);
    setErrorMessage("");
    setActionMessage("");

    const result = await supabase.functions.invoke("check-production-launch-audit", {
      body: { launch_request_id: launch.id },
    });

    setAuditingId("");
    if (result.error) {
      setErrorMessage(`Production launch audit failed: ${result.error.message}`);
      return;
    }

    const audit = result.data as AuditResult;
    setLaunches((current) =>
      current.map((item) =>
        item.id === launch.id
          ? {
              ...item,
              status: audit.status,
              audit_status: audit.audit_status,
              audit_checked_at: audit.checked_at,
              audit_details: audit.checks,
              critical_blockers: audit.critical_blockers,
              warnings: audit.warnings,
              production_branch: audit.production_branch,
              production_url: audit.production_url,
            }
          : item
      )
    );

    setActionMessage(
      audit.passed
        ? `Launch audit passed with ${audit.warnings.length} warning(s). Production: No.`
        : `Launch audit blocked by ${audit.critical_blockers.length} critical item(s). Production: No.`
    );
  }

  async function decideLaunch(launch: LaunchRow, decision: "approved_for_production" | "rejected") {
    if (!supabase) return;
    if (decision === "approved_for_production" && launch.audit_status !== "passed") {
      setErrorMessage("A passing launch audit is required before production approval.");
      return;
    }

    const note = window.prompt(
      decision === "approved_for_production"
        ? "Production approval note (required)"
        : "Production rejection reason (required)",
      launch.owner_decision_note || ""
    );
    if (note === null) return;
    if (!note.trim()) {
      setErrorMessage("A decision note is required.");
      return;
    }

    const userResult = await supabase.auth.getUser();
    if (userResult.error || !userResult.data.user) {
      setErrorMessage(userResult.error?.message || "Unable to confirm the owner account.");
      return;
    }

    setDecidingId(launch.id);
    setErrorMessage("");
    setActionMessage("");

    const result = await supabase
      .from("production_launch_requests")
      .update({
        status: decision,
        owner_decision_by: userResult.data.user.id,
        owner_decision_at: new Date().toISOString(),
        owner_decision_note: note.trim(),
      })
      .eq("id", launch.id)
      .in("status", decision === "approved_for_production" ? ["audit_passed", "pending_owner_approval"] : ["audit_passed", "audit_blocked", "pending_owner_approval", "audit_required"])
      .select(launchSelect)
      .single();

    setDecidingId("");
    if (result.error) {
      setErrorMessage(`Production decision failed: ${result.error.message}`);
      return;
    }

    setLaunches((current) => current.map((item) => (item.id === launch.id ? (result.data as LaunchRow) : item)));
    setActionMessage(
      decision === "approved_for_production"
        ? "Production launch approved. Nothing was deployed; execution is not enabled yet."
        : "Production launch rejected. Nothing was deployed."
    );
  }

  return (
    <main className="nxq-page">
      <section className="portal-shell">
        <div className="panel-title panel-title-row">
          <div className="panel-title">
            <Rocket size={22} />
            <div>
              <h1>Production launches</h1>
              <p className="subtle">Read-only launch audits and explicit owner decisions. Production execution is not enabled.</p>
            </div>
          </div>
          <div className="client-control-row">
            <a className="icon-btn" href="/owner/preview-requests"><ArrowLeft size={16} />Preview requests</a>
            <a className="icon-btn" href="/owner/deployments"><ShieldCheck size={16} />Deployments</a>
            <button className="icon-btn" type="button" onClick={() => void loadData()}><RefreshCcw size={16} />Refresh</button>
          </div>
        </div>

        {errorMessage ? <div className="auth-error">{errorMessage}</div> : null}
        {actionMessage ? <div className="auth-success">{actionMessage}</div> : null}

        <section className="panel">
          <div className="panel-title"><Rocket size={20} /><h2>Create launch request</h2></div>
          <div className="owner-reply-box">
            <label htmlFor="published-preview">Published preview</label>
            <select
              id="published-preview"
              className="message-filter-select"
              value={selectedPreviewId}
              onChange={(event) => setSelectedPreviewId(event.target.value)}
            >
              <option value="">Pick a published preview</option>
              {availablePreviews.map((preview) => (
                <option key={preview.id} value={preview.id}>
                  {clientNameById.get(preview.client_id) || "Unknown client"} · {preview.source_branch}
                </option>
              ))}
            </select>
            <button className="wide-btn" type="button" disabled={!selectedPreviewId || creating} onClick={() => void createLaunchRequest()}>
              <ShieldCheck size={16} />{creating ? "Creating request..." : "Create production launch request"}
            </button>
            <small>This creates an approval record only. No build or production deployment is triggered.</small>
          </div>
        </section>

        <section className="panel">
          <div className="panel-title"><SearchCheck size={20} /><h2>Launch approval queue</h2></div>
          {isLoading ? <div className="empty-state">Loading production launch requests...</div> : null}
          {!isLoading && launches.length === 0 ? <div className="empty-state">No production launch requests yet.</div> : null}

          <div className="owner-message-list">
            {launches.map((launch) => {
              const preview = previews.find((item) => item.id === launch.preview_request_id);
              return (
                <article className="owner-message-card" key={launch.id}>
                  <div className="owner-message-top">
                    <strong>{clientNameById.get(launch.client_id) || "Unknown client"}</strong>
                    <span>{formatDateTime(launch.created_at)}</span>
                  </div>
                  <p>{formatStatus(launch.status)}</p>
                  <small>Production branch: {launch.production_branch}</small>
                  <small>Production URL: {launch.production_url || "Not configured"}</small>
                  {preview?.preview_url ? <a href={preview.preview_url} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Open approved preview</a> : null}

                  {["audit_required", "audit_blocked", "audit_passed"].includes(launch.status) ? (
                    <button className="wide-btn" type="button" disabled={auditingId === launch.id} onClick={() => void runAudit(launch)}>
                      <SearchCheck size={16} />{auditingId === launch.id ? "Running launch audit..." : "Run production launch audit"}
                    </button>
                  ) : null}

                  {launch.audit_checked_at ? (
                    <div className={launch.audit_status === "passed" ? "auth-success" : "auth-error"}>
                      <strong>Audit {launch.audit_status}</strong>
                      <small>Checked: {formatDateTime(launch.audit_checked_at)}</small>
                      <small>Critical blockers: {launch.critical_blockers.length}</small>
                      <small>Warnings: {launch.warnings.length}</small>
                    </div>
                  ) : <small>Launch audit: Not run yet</small>}

                  {launch.critical_blockers.length > 0 ? (
                    <div className="auth-error">
                      <strong><XCircle size={15} /> Critical blockers</strong>
                      {launch.critical_blockers.map((item) => <div key={item.key}>{formatStatus(item.key)}: {item.message}</div>)}
                    </div>
                  ) : null}

                  {launch.warnings.length > 0 ? (
                    <div className="auth-success">
                      <strong><AlertTriangle size={15} /> Warnings</strong>
                      {launch.warnings.map((item) => <div key={item.key}>{formatStatus(item.key)}: {item.message}</div>)}
                    </div>
                  ) : null}

                  {launch.audit_details ? (
                    <div className={launch.audit_status === "passed" ? "auth-success" : "auth-error"}>
                      {Object.entries(launch.audit_details).map(([key, check]) => (
                        <div key={key}>{check.ok ? <CheckCircle2 size={15} /> : <XCircle size={15} />} {formatStatus(key)}: {check.message}</div>
                      ))}
                      <small>This audit is read-only.</small>
                    </div>
                  ) : null}

                  {launch.status === "audit_passed" ? (
                    <div className="client-control-row">
                      <button className="wide-btn" type="button" disabled={decidingId === launch.id} onClick={() => void decideLaunch(launch, "approved_for_production")}>
                        <CheckCircle2 size={16} />Approve production launch
                      </button>
                      <button className="wide-btn danger" type="button" disabled={decidingId === launch.id} onClick={() => void decideLaunch(launch, "rejected")}>
                        <XCircle size={16} />Reject production launch
                      </button>
                    </div>
                  ) : null}

                  {launch.status === "audit_blocked" || launch.status === "audit_required" ? (
                    <button className="wide-btn danger" type="button" disabled={decidingId === launch.id} onClick={() => void decideLaunch(launch, "rejected")}>
                      <XCircle size={16} />Reject production launch
                    </button>
                  ) : null}

                  {launch.owner_decision_at ? <small>Decision recorded: {formatDateTime(launch.owner_decision_at)}</small> : null}
                  {launch.owner_decision_note ? <small>Decision note: {launch.owner_decision_note}</small> : null}
                  <small>Production deployment execution is not enabled on this page.</small>
                </article>
              );
            })}
          </div>
        </section>
      </section>
    </main>
  );
}
