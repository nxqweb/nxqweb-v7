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
  severity: "critical" | "warning" | "info";
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
  prepared_at: string | null;
  deployment_record_id: string | null;
  execution_started_at: string | null;
  execution_completed_at: string | null;
  netlify_build_id: string | null;
  netlify_deploy_id: string | null;
  error_message: string | null;
  created_at: string;
};

type AuditResult = {
  passed: boolean;
  status: "audit_passed" | "audit_blocked" | "approved_for_production" | "prepared";
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

type PreparationResult = {
  status: "prepared";
  prepared_at: string;
  production: false;
  deployment_record: { id: string };
};

type BuildStartResult = {
  status: "launching";
  branch: string;
  production_commit_sha: string;
  netlify_build_id: string;
  netlify_deploy_id: string | null;
  production_build_started: true;
  production_published: false;
};

const launchSelect =
  "id, deployment_config_id, project_id, client_id, preview_request_id, production_branch, production_url, status, audit_checked_at, audit_status, audit_details, critical_blockers, warnings, owner_decision_at, owner_decision_note, prepared_at, deployment_record_id, execution_started_at, execution_completed_at, netlify_build_id, netlify_deploy_id, error_message, created_at";

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
  const [preparingId, setPreparingId] = useState("");
  const [startingId, setStartingId] = useState("");
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
    () =>
      new Set(
        launches
          .filter((launch) => !["rejected", "cancelled", "failed"].includes(launch.status))
          .map((launch) => launch.preview_request_id)
      ),
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
      .in(
        "status",
        decision === "approved_for_production"
          ? ["audit_passed", "pending_owner_approval"]
          : ["audit_passed", "audit_blocked", "pending_owner_approval", "audit_required"]
      )
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

  async function prepareLaunch(launch: LaunchRow) {
    if (!supabase) return;

    const confirmed = window.confirm(
      "Prepare one internal queued production execution record? This will not call GitHub, Netlify, or deploy production."
    );
    if (!confirmed) return;

    setPreparingId(launch.id);
    setErrorMessage("");
    setActionMessage("");

    const result = await supabase.functions.invoke("prepare-production-deployment-execution", {
      body: { launch_request_id: launch.id },
    });

    setPreparingId("");
    if (result.error) {
      setErrorMessage(
        `Production preparation failed: ${result.error.message}. Run a fresh production launch audit and try again.`
      );
      return;
    }

    const preparation = result.data as PreparationResult;
    setLaunches((current) =>
      current.map((item) =>
        item.id === launch.id
          ? {
              ...item,
              status: preparation.status,
              prepared_at: preparation.prepared_at,
              deployment_record_id: preparation.deployment_record.id,
            }
          : item
      )
    );
    setActionMessage("Production execution prepared internally. Nothing was deployed. Production: No.");
  }

  async function startProductionBuild(launch: LaunchRow) {
    if (!supabase) return;

    const confirmation = window.prompt(
      `LIVE ACTION: Start one Netlify build from production branch ${launch.production_branch}? This may use build credits. Type START_PRODUCTION_BUILD exactly to continue.`,
      ""
    );

    if (confirmation === null) return;
    if (confirmation.trim() !== "START_PRODUCTION_BUILD") {
      setErrorMessage("Production build cancelled: the exact confirmation phrase was not entered.");
      return;
    }

    setStartingId(launch.id);
    setErrorMessage("");
    setActionMessage("");

    const result = await supabase.functions.invoke("execute-production-netlify-build", {
      body: {
        launch_request_id: launch.id,
        confirmation: "START_PRODUCTION_BUILD",
      },
    });

    setStartingId("");
    if (result.error) {
      setErrorMessage(`Production build start failed: ${result.error.message}. Do not click again until this error is reviewed.`);
      return;
    }

    const execution = result.data as BuildStartResult;
    setLaunches((current) =>
      current.map((item) =>
        item.id === launch.id
          ? {
              ...item,
              status: execution.status,
              execution_started_at: new Date().toISOString(),
              netlify_build_id: execution.netlify_build_id,
              netlify_deploy_id: execution.netlify_deploy_id,
            }
          : item
      )
    );

    setActionMessage(
      "Production-branch build started. Live publication has NOT been confirmed. Do not start another build."
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
              <p className="subtle">Owner approval, launch audits, guarded preparation, and controlled production builds.</p>
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

                  {["audit_required", "audit_blocked", "audit_passed", "approved_for_production"].includes(launch.status) ? (
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

                  {launch.status === "approved_for_production" ? (
                    <button className="wide-btn" type="button" disabled={preparingId === launch.id} onClick={() => void prepareLaunch(launch)}>
                      <ShieldCheck size={16} />
                      {preparingId === launch.id ? "Preparing production execution..." : "Prepare production execution"}
                    </button>
                  ) : null}

                  {launch.status === "prepared" ? (
                    <>
                      <div className="auth-success">
                        <strong>Production execution prepared</strong>
                        <small>Internal status: prepared · queued record created</small>
                        {launch.prepared_at ? <small>Prepared: {formatDateTime(launch.prepared_at)}</small> : null}
                        {launch.deployment_record_id ? <small>Record: {launch.deployment_record_id.slice(0, 8)}</small> : null}
                        <small>No production build has started yet.</small>
                      </div>
                      <div className="auth-error">
                        <strong>Live production action</strong>
                        <small>This starts one Netlify build from {launch.production_branch} and may use build credits.</small>
                        <small>Publication will not be marked complete until a separate status check confirms it.</small>
                      </div>
                      <button className="wide-btn danger" type="button" disabled={startingId === launch.id} onClick={() => void startProductionBuild(launch)}>
                        <Rocket size={16} />
                        {startingId === launch.id ? "Starting production build..." : "Start production build"}
                      </button>
                    </>
                  ) : null}

                  {launch.status === "launching" ? (
                    <div className="auth-success">
                      <strong>Production-branch build started</strong>
                      <small>Live publication confirmed: No</small>
                      {launch.execution_started_at ? <small>Started: {formatDateTime(launch.execution_started_at)}</small> : null}
                      {launch.netlify_build_id ? <small>Build: {launch.netlify_build_id.slice(0, 8)}</small> : null}
                      {launch.netlify_deploy_id ? <small>Deploy: {launch.netlify_deploy_id.slice(0, 8)}</small> : null}
                      <small>Do not start another build. Status must be checked separately.</small>
                    </div>
                  ) : null}

                  {launch.status === "failed" && launch.error_message ? (
                    <div className="auth-error">Production execution failed: {launch.error_message}</div>
                  ) : null}

                  {!['launching', 'published'].includes(launch.status) ? <small>Production publication has not been confirmed.</small> : null}
                </article>
              );
            })}
          </div>
        </section>
      </section>
    </main>
  );
}
